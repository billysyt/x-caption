#!/usr/bin/env python3
"""
Native Job Queue - SQLite-based replacement for Redis + RQ
No external dependencies required
"""
import sqlite3
import threading
import time
import json
import uuid
import traceback
from pathlib import Path
from typing import Dict, Any, Optional, Callable
from datetime import datetime
import queue
import logging

logger = logging.getLogger(__name__)


class Job:
    """Job object compatible with RQ Job interface"""

    def __init__(self, job_id: str, func: Callable, kwargs: Dict[str, Any], queue_name: str = 'default'):
        self.id = job_id
        self.func = func
        self.func_name = f"{func.__module__}.{func.__name__}"
        self.kwargs = kwargs
        self.queue_name = queue_name
        self.meta = {}
        self.result = None
        self.exc_info = None
        self.created_at = datetime.now()
        self.started_at = None
        self.ended_at = None
        self._status = 'queued'

    def get_status(self):
        return self._status

    def is_finished(self):
        return self._status == 'finished'

    def is_failed(self):
        return self._status == 'failed'

    def cancel(self):
        self._status = 'canceled'


class NativeJobQueue:
    """SQLite-based job queue that mimics Redis + RQ behavior"""

    def __init__(self, name: str = 'default', db_path: str = None):
        self.name = name

        # Use app data directory for database
        if db_path is None:
            from native_config import get_data_dir
            db_dir = get_data_dir()
            db_path = str(db_dir / 'jobs.db')

        self.db_path = db_path
        self.conn = None
        self.lock = threading.Lock()
        self.job_updates = {}  # In-memory storage for real-time updates
        self.active_jobs = {}  # Track active Job objects
        self._init_db()

        self.job_queue = queue.Queue()
        self.running = False
        self._recover_pending_jobs()

    def _recover_pending_jobs(self) -> None:
        """Reset interrupted jobs to pending status without auto-resuming."""
        try:
            with self.lock:
                rows = self.conn.execute(
                    """
                    SELECT job_id, func_name, status
                    FROM jobs
                    WHERE queue_name = ? AND status IN ('started')
                    """,
                    (self.name,),
                ).fetchall()
        except Exception as exc:
            logger.warning("Failed to load interrupted jobs for recovery: %s", exc)
            return

        reset_count = 0

        for row in rows:
            job_id, func_name, status = row

            # Reset interrupted jobs back to pending (queued) status
            # Do NOT add them back to the job queue - user must manually restart
            with self.lock:
                self.conn.execute(
                    "UPDATE jobs SET status = ?, started_at = NULL, ended_at = NULL, error = NULL WHERE job_id = ?",
                    ('queued', job_id),
                )
                self.conn.commit()

            # Update metadata to indicate the job was interrupted
            self.update_job_meta(
                job_id,
                {
                    "message": "Job was interrupted. Please restart manually.",
                    "progress": 0,
                },
            )
            reset_count += 1

        if reset_count > 0:
            logger.info(
                "Job recovery complete for queue '%s': reset to pending=%s (not auto-resumed)",
                self.name,
                reset_count,
            )

    def _init_db(self):
        """Initialize SQLite database"""
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)

        with self.lock:
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS jobs (
                    job_id TEXT PRIMARY KEY,
                    queue_name TEXT,
                    func_name TEXT,
                    kwargs TEXT,
                    status TEXT,
                    created_at REAL,
                    started_at REAL,
                    ended_at REAL,
                    meta TEXT,
                    result TEXT,
                    error TEXT
                )
            """)

            # Create index for faster queries
            self.conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_status ON jobs(status)
            """)
            self.conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_queue ON jobs(queue_name, status)
            """)

            self.conn.commit()

        logger.info(f"Initialized job queue '{self.name}' with database: {self.db_path}")

    def enqueue(self, func: Callable, kwargs: Dict[str, Any] = None,
                job_id: str = None):
        """Add job to queue"""
        if kwargs is None:
            kwargs = {}

        if job_id is None:
            job_id = str(uuid.uuid4())

        # Clear stale in-memory updates when reusing a job id.
        if job_id in self.job_updates:
            del self.job_updates[job_id]

        # Create job object
        job = Job(job_id=job_id, func=func, kwargs=kwargs, queue_name=self.name)

        # Store in active jobs
        self.active_jobs[job_id] = job

        # Store in database
        with self.lock:
            self.conn.execute("""
                INSERT OR REPLACE INTO jobs
                (job_id, queue_name, func_name, kwargs, status, created_at, started_at, ended_at, meta, result, error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                job_id,
                self.name,
                job.func_name,
                json.dumps(kwargs),
                'queued',
                time.time(),
                None,
                None,
                json.dumps({}),
                None,
                None
            ))
            self.conn.commit()

        # Add to processing queue
        self.job_queue.put((job, func, kwargs))

        logger.info(f"Enqueued job {job_id} to queue '{self.name}'")
        return job

    def fetch_job(self, job_id: str):
        """Fetch job by ID (compatible with RQ Job.fetch)"""
        # IMPORTANT: Jobs live in a shared DB across all queue instances. Do not
        # trust per-queue in-memory caches alone, or status can go stale (e.g. a
        # "low" queue job fetched via the "high" queue would otherwise stay
        # "started" forever and make the UI oscillate between processing/done).

        terminal_states = {"finished", "failed", "canceled", "cancelled", "deleted"}

        cached = self.active_jobs.get(job_id)
        if cached is not None and cached.get_status() in terminal_states:
            return cached

        # Refresh from database (lightweight query for cached jobs).
        if cached is not None:
            with self.lock:
                row = self.conn.execute(
                    "SELECT status, started_at, ended_at, error FROM jobs WHERE job_id = ?",
                    (job_id,),
                ).fetchone()
            if not row:
                raise Exception(f"Job {job_id} not found")

            status, started_at, ended_at, error = row
            cached._status = status or cached._status
            cached.started_at = datetime.fromtimestamp(started_at) if started_at else cached.started_at
            cached.ended_at = datetime.fromtimestamp(ended_at) if ended_at else cached.ended_at
            cached.exc_info = error
            return cached

        # Not cached: load the full job record once.
        with self.lock:
            row = self.conn.execute("""
                SELECT job_id, queue_name, func_name, kwargs, status,
                       created_at, started_at, ended_at, meta, result, error
                FROM jobs WHERE job_id = ?
            """, (job_id,)).fetchone()

        if not row:
            raise Exception(f"Job {job_id} not found")

        # Reconstruct job object
        job = Job(job_id=row[0], func=lambda: None, kwargs={}, queue_name=row[1])
        job.func_name = row[2]
        try:
            job.kwargs = json.loads(row[3]) if row[3] else {}
        except Exception:
            job.kwargs = {}
        job._status = row[4]
        job.created_at = datetime.fromtimestamp(row[5]) if row[5] else None
        job.started_at = datetime.fromtimestamp(row[6]) if row[6] else None
        job.ended_at = datetime.fromtimestamp(row[7]) if row[7] else None
        try:
            job.meta = json.loads(row[8]) if row[8] else {}
        except Exception:
            job.meta = {}
        try:
            job.result = json.loads(row[9]) if row[9] else None
        except Exception:
            job.result = None
        job.exc_info = row[10]

        self.active_jobs[job_id] = job
        return job

    def update_job_status(self, job_id: str, status: str, result: Any = None, error: str = None):
        """Update job status in database"""
        with self.lock:
            updates = {'status': status}

            if status == 'started':
                updates['started_at'] = time.time()
            elif status in ['finished', 'failed', 'canceled']:
                updates['ended_at'] = time.time()

            if result is not None:
                updates['result'] = json.dumps(result)

            if error is not None:
                updates['error'] = error

            # Build SQL update
            set_clause = ', '.join([f"{k} = ?" for k in updates.keys()])
            values = list(updates.values()) + [job_id]

            self.conn.execute(f"UPDATE jobs SET {set_clause} WHERE job_id = ?", values)
            self.conn.commit()

        # Update active job
        if job_id in self.active_jobs:
            job = self.active_jobs[job_id]
            job._status = status
            if result is not None:
                job.result = result
            if error is not None:
                job.exc_info = error

    def update_job_meta(self, job_id: str, meta: Dict[str, Any]):
        """Update job metadata"""
        with self.lock:
            # Get current meta
            cursor = self.conn.execute("SELECT meta FROM jobs WHERE job_id = ?", (job_id,))
            row = cursor.fetchone()

            if row:
                current_meta = json.loads(row[0]) if row[0] else {}
                current_meta.update(meta)

                self.conn.execute(
                    "UPDATE jobs SET meta = ? WHERE job_id = ?",
                    (json.dumps(current_meta), job_id)
                )
                self.conn.commit()

                # Store for polling
                self.job_updates[job_id] = current_meta

        # Update active job
        if job_id in self.active_jobs:
            job = self.active_jobs[job_id]
            job.meta.update(meta)

    def get_job_updates(self, job_id: str) -> Dict[str, Any]:
        """Get latest job updates (for polling)"""
        return self.job_updates.get(job_id, {})

    def remove_job(self, job_id: str):
        """Remove job from queue and database"""
        with self.lock:
            self.conn.execute("DELETE FROM jobs WHERE job_id = ?", (job_id,))
            self.conn.commit()

        if job_id in self.active_jobs:
            del self.active_jobs[job_id]

        if job_id in self.job_updates:
            del self.job_updates[job_id]

    def __len__(self):
        """Get queue length"""
        with self.lock:
            cursor = self.conn.execute(
                "SELECT COUNT(*) FROM jobs WHERE queue_name = ? AND status = 'queued'",
                (self.name,)
            )
            return cursor.fetchone()[0]

    @property
    def job_ids(self):
        """Get all job IDs in queue"""
        with self.lock:
            cursor = self.conn.execute(
                "SELECT job_id FROM jobs WHERE queue_name = ? AND status = 'queued'",
                (self.name,)
            )
            return [row[0] for row in cursor.fetchall()]


class NativeWorker:
    """Worker that processes jobs from NativeJobQueue"""

    def __init__(self, queues: list, num_threads: int = 2):
        self.queues = queues
        self.num_threads = num_threads
        self.running = False
        self.threads = []

    def work(self):
        """Start processing jobs"""
        self.running = True

        logger.info(f"Starting {self.num_threads} worker threads for queues: {[q.name for q in self.queues]}")

        # Start worker threads
        for i in range(self.num_threads):
            thread = threading.Thread(target=self._worker_loop, args=(i,), daemon=True)
            thread.start()
            self.threads.append(thread)

        # Keep main thread alive
        try:
            while self.running:
                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("Worker interrupted by user")
            self.running = False

    def _worker_loop(self, worker_id: int):
        """Worker thread loop"""
        logger.info(f"Worker thread {worker_id} started")

        while self.running:
            job_processed = False
            # Check each queue (high priority first)
            for job_queue in self.queues:
                try:
                    # Try to get a job (non-blocking)
                    job, func, kwargs = job_queue.job_queue.get(timeout=0.1)
                    job_processed = True

                    logger.info(f"Worker {worker_id} processing job {job.id}")

                    # Update status to started
                    job_queue.update_job_status(job.id, 'started')
                    job._status = 'started'
                    job.started_at = datetime.now()

                    try:
                        # Execute the job
                        result = func(**kwargs)

                        # Update status to finished
                        job_queue.update_job_status(job.id, 'finished', result=result)
                        job._status = 'finished'
                        job.result = result
                        job.ended_at = datetime.now()

                        logger.info(f"Worker {worker_id} completed job {job.id}")

                    except Exception as e:
                        # Job failed
                        error_msg = traceback.format_exc()
                        logger.error(
                            "Worker %s job %s failed: %s\n%s",
                            worker_id,
                            job.id,
                            e,
                            error_msg,
                        )

                        job_queue.update_job_status(job.id, 'failed', error=error_msg)
                        job._status = 'failed'
                        job.exc_info = error_msg
                        job.ended_at = datetime.now()

                    break  # Job processed, exit queue loop

                except queue.Empty:
                    # Queue is empty or other error, try next queue
                    continue

            # If no job was processed, sleep briefly
            if not job_processed:
                time.sleep(0.5)

        logger.info(f"Worker thread {worker_id} stopped")


# Singleton instances
_queues = {}
_worker = None


def get_queue(name: str = 'default') -> NativeJobQueue:
    """Get or create a queue"""
    global _queues

    if name not in _queues:
        _queues[name] = NativeJobQueue(name)

    return _queues[name]


def start_worker(num_threads: int = 2):
    """Start the worker threads"""
    global _worker, _queues

    if _worker is None:
        # Create queues if they don't exist
        high_queue = get_queue('high')
        default_queue = get_queue('default')
        low_queue = get_queue('low')

        _worker = NativeWorker([high_queue, default_queue, low_queue], num_threads=num_threads)

        # Start worker in background thread
        worker_thread = threading.Thread(target=_worker.work, daemon=True)
        worker_thread.start()

        logger.info(f"Started native worker with {num_threads} threads")

    return _worker


def get_worker() -> Optional[NativeWorker]:
    """Get the worker instance"""
    return _worker
