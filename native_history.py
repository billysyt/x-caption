#!/usr/bin/env python3
"""Job history helpers backed by the SQLite queue database."""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import hashlib

from native_config import get_data_dir
from native_job_queue import get_queue

logger = logging.getLogger(__name__)

LEGACY_HISTORY_FILE = get_data_dir() / "history.json"


def _cleanup_legacy_history() -> None:
    try:
        if LEGACY_HISTORY_FILE.exists():
            LEGACY_HISTORY_FILE.unlink()
    except Exception as exc:
        logger.debug("Failed to remove legacy history file: %s", exc)


FINISHED_STATES = {"finished", "completed"}
FAILED_STATES = {"failed", "errored"}
CANCELLED_STATES = {"canceled", "cancelled"}


def _db_path() -> Path:
    data_dir = get_data_dir()
    return data_dir / "jobs.db"


def _connect() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    _ensure_records_table(conn)
    return conn


def _ensure_records_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS job_records (
            job_id TEXT PRIMARY KEY,
            filename TEXT,
            display_name TEXT,
            media_path TEXT,
            media_kind TEXT,
            media_hash TEXT,
            media_size INTEGER,
            media_mtime REAL,
            status TEXT,
            language TEXT,
            device TEXT,
            summary TEXT,
            transcript_json TEXT,
            transcript_text TEXT,
            segment_count INTEGER,
            duration REAL,
            created_at REAL,
            updated_at REAL,
            ui_state TEXT
        )
        """
    )
    _ensure_columns(conn, {
        "media_hash": "TEXT",
        "media_size": "INTEGER",
        "media_mtime": "REAL",
        "display_name": "TEXT",
    })
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_job_records_updated
        ON job_records(updated_at)
        """
    )


def _ensure_columns(conn: sqlite3.Connection, columns: Dict[str, str]) -> None:
    existing = {
        row[1]
        for row in conn.execute("PRAGMA table_info(job_records)").fetchall()
    }
    for name, col_type in columns.items():
        if name in existing:
            continue
        try:
            conn.execute(f"ALTER TABLE job_records ADD COLUMN {name} {col_type}")
        except sqlite3.OperationalError as exc:
            if "duplicate column name" in str(exc).lower():
                continue
            raise


def get_file_meta(path: str) -> Tuple[Optional[int], Optional[float]]:
    try:
        stat = Path(path).stat()
        return stat.st_size, stat.st_mtime
    except Exception:
        return None, None


def compute_file_hash(path: str, chunk_size: int = 1024 * 1024) -> Optional[str]:
    try:
        hasher = hashlib.sha256()
        with open(path, "rb") as handle:
            while True:
                chunk = handle.read(chunk_size)
                if not chunk:
                    break
                hasher.update(chunk)
        return hasher.hexdigest()
    except Exception:
        return None


def is_media_invalid(
    media_path: Optional[str],
    media_hash: Optional[str],
    media_size: Optional[int],
    media_mtime: Optional[float],
) -> Optional[bool]:
    if not media_path or not media_hash:
        return None
    current_size, current_mtime = get_file_meta(media_path)
    if current_size is None or current_mtime is None:
        return True
    if (
        media_size is not None
        and media_mtime is not None
        and current_size == media_size
        and current_mtime == media_mtime
    ):
        return False
    current_hash = compute_file_hash(media_path)
    if not current_hash:
        return True
    return current_hash != media_hash


def _serialize_json(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return None


def _parse_json(value: Optional[str]) -> Optional[Dict[str, Any]]:
    if not value:
        return None
    try:
        return json.loads(value)
    except Exception:
        return None


def _strip_extension(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        name = Path(str(value)).name
    except Exception:
        name = str(value)
    if "." not in name:
        return name
    return name.rsplit(".", 1)[0] or name


def upsert_job_record(record: Dict[str, Any]) -> None:
    job_id = record.get("job_id")
    if not job_id:
        return

    now = time.time()
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT filename, display_name, media_path, media_kind, media_hash, media_size, media_mtime,
                   status, language, device, summary, transcript_json, transcript_text,
                   segment_count, duration, created_at, ui_state
            FROM job_records
            WHERE job_id = ?
            """,
            (job_id,),
        ).fetchone()
        existing = None
        if row:
            existing = {
                "filename": row[0],
                "display_name": row[1],
                "media_path": row[2],
                "media_kind": row[3],
                "media_hash": row[4],
                "media_size": row[5],
                "media_mtime": row[6],
                "status": row[7],
                "language": row[8],
                "device": row[9],
                "summary": row[10],
                "transcript_json": row[11],
                "transcript_text": row[12],
                "segment_count": row[13],
                "duration": row[14],
                "created_at": row[15],
                "ui_state": row[16],
            }

        def pick(key: str, serializer=None):
            if key in record:
                value = record.get(key)
                return serializer(value) if serializer else value
            if existing:
                return existing.get(key)
            return None

        created_at = record.get("created_at") or (existing.get("created_at") if existing else None) or now
        updated_at = record.get("updated_at") or now

        media_path = pick("media_path")
        media_hash = pick("media_hash")
        media_size = pick("media_size")
        media_mtime = pick("media_mtime")

        if media_path:
            if media_size is None or media_mtime is None:
                current_size, current_mtime = get_file_meta(str(media_path))
                if media_size is None:
                    media_size = current_size
                if media_mtime is None:
                    media_mtime = current_mtime
            if media_hash is None:
                media_hash = compute_file_hash(str(media_path))

        display_name = pick("display_name") or _strip_extension(pick("filename"))
        payload = {
            "job_id": job_id,
            "filename": pick("filename"),
            "display_name": display_name,
            "media_path": media_path,
            "media_kind": pick("media_kind"),
            "media_hash": media_hash,
            "media_size": media_size,
            "media_mtime": media_mtime,
            "status": pick("status"),
            "language": pick("language"),
            "device": pick("device"),
            "summary": pick("summary"),
            "transcript_json": pick("transcript_json", _serialize_json),
            "transcript_text": pick("transcript_text"),
            "segment_count": pick("segment_count"),
            "duration": pick("duration"),
            "created_at": created_at,
            "updated_at": updated_at,
            "ui_state": pick("ui_state", _serialize_json),
        }

        columns = ", ".join(payload.keys())
        placeholders = ", ".join(["?"] * len(payload))
        updates = ", ".join([f"{key}=excluded.{key}" for key in payload.keys() if key != "job_id"])
        conn.execute(
            f"""
            INSERT INTO job_records ({columns})
            VALUES ({placeholders})
            ON CONFLICT(job_id) DO UPDATE SET {updates}
            """,
            tuple(payload.values()),
        )
        conn.commit()


def get_job_record(job_id: str) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT job_id, filename, display_name, media_path, media_kind, media_hash, media_size, media_mtime,
                   status, language, device, summary, transcript_json, transcript_text,
                   segment_count, duration, created_at, updated_at, ui_state
            FROM job_records
            WHERE job_id = ?
            """,
            (job_id,),
        ).fetchone()

    if not row:
        return None

    (
        job_id,
        filename,
        display_name,
        media_path,
        media_kind,
        media_hash,
        media_size,
        media_mtime,
        status,
        language,
        device,
        summary,
        transcript_json,
        transcript_text,
        segment_count,
        duration,
        created_at,
        updated_at,
        ui_state,
    ) = row

    if not filename and media_path:
        try:
            filename = Path(str(media_path)).name
        except Exception:
            filename = filename

    transcript = _parse_json(transcript_json)
    if not media_path and transcript:
        media_path = transcript.get("file_path") or transcript.get("original_audio_path")
    if not filename and media_path:
        try:
            filename = Path(str(media_path)).name
        except Exception:
            filename = filename

    return {
        "job_id": job_id,
        "filename": filename,
        "display_name": display_name or _strip_extension(filename) or job_id,
        "media_path": media_path,
        "media_kind": media_kind,
        "media_hash": media_hash,
        "media_size": media_size,
        "media_mtime": media_mtime,
        "media_invalid": is_media_invalid(media_path, media_hash, media_size, media_mtime),
        "status": status,
        "language": language,
        "device": device,
        "summary": summary,
        "transcript": transcript,
        "transcript_text": transcript_text,
        "segment_count": segment_count,
        "duration": duration,
        "created_at": created_at,
        "updated_at": updated_at,
        "ui_state": _parse_json(ui_state),
    }


def update_job_ui_state(job_id: str, ui_state: Dict[str, Any]) -> None:
    upsert_job_record({"job_id": job_id, "ui_state": ui_state})


def update_job_transcript(job_id: str, transcript: Dict[str, Any]) -> None:
    text = transcript.get("text") if isinstance(transcript, dict) else None
    segments = transcript.get("segments") if isinstance(transcript, dict) else None
    upsert_job_record({
        "job_id": job_id,
        "transcript_json": transcript,
        "transcript_text": text,
        "segment_count": len(segments) if isinstance(segments, list) else None,
        "language": transcript.get("language") if isinstance(transcript, dict) else None,
        "duration": transcript.get("audio_duration") if isinstance(transcript, dict) else None,
        "status": "completed",
    })


def _ts_to_iso(ts: Optional[float]) -> Optional[str]:
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    except Exception:
        return None


def load_history(limit: int = 200) -> List[Dict[str, Any]]:
    """Return recent jobs stored in the records table."""
    _cleanup_legacy_history()
    entries: List[Dict[str, Any]] = []

    try:
        with _connect() as conn:
            rows = conn.execute(
                """
                SELECT job_id, filename, display_name, media_path, media_kind, media_hash, media_size, media_mtime,
                       status, language, device, summary, transcript_text, segment_count, duration,
                       created_at, updated_at, ui_state, transcript_json
                FROM job_records
                ORDER BY COALESCE(updated_at, created_at) DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

        for row in rows:
            (
                job_id,
                filename,
                display_name,
                media_path,
                media_kind,
                media_hash,
                media_size,
                media_mtime,
                status,
                language,
                device,
                summary,
                transcript_text,
                segment_count,
                duration,
                created_at,
                updated_at,
                ui_state,
                transcript_json,
            ) = row

            transcript = _parse_json(transcript_json)
            if not filename and media_path:
                try:
                    filename = Path(str(media_path)).name
                except Exception:
                    filename = filename
            if not display_name:
                display_name = _strip_extension(filename) or filename or job_id

            if not filename and not media_path and not transcript_text and not transcript:
                continue
            if not media_path and transcript:
                media_path = transcript.get("file_path") or transcript.get("original_audio_path")

            normalized_status = (status or "completed").lower()
            progress = 100 if normalized_status in FINISHED_STATES else (-1 if normalized_status in FAILED_STATES else 0)

            entry: Dict[str, Any] = {
                "job_id": job_id,
                "status": status or "completed",
                "message": "",
                "created_at": _ts_to_iso(created_at),
                "completed_at": _ts_to_iso(updated_at),
                "language": language,
                "device": device,
                "summary": summary or (transcript_text or "")[:500],
                "progress": progress,
                "original_filename": filename or job_id,
                "display_name": display_name,
                "media_path": media_path,
                "media_kind": media_kind,
                "media_hash": media_hash,
                "media_size": media_size,
                "media_mtime": media_mtime,
                "media_invalid": is_media_invalid(media_path, media_hash, media_size, media_mtime),
                "audio_file": {
                    "name": filename or job_id,
                    "path": media_path,
                    "size": media_size,
                    "hash": media_hash,
                    "mtime": media_mtime,
                },
                "ui_state": _parse_json(ui_state),
            }

            if transcript_text or segment_count:
                entry["result_preview"] = {
                    "segment_count": int(segment_count or 0),
                    "text": transcript_text,
                    "language": language,
                }

            if duration is not None:
                entry["audio_duration"] = duration

            entries.append(entry)
    except Exception as exc:
        logger.error("Failed to load job history: %s", exc)

    return entries


def mark_completed(
    *,
    job_id: str,
    original_filename: str,
    message: str,
    result: Dict[str, Any],
    output_dir: Path,
    audio_file: Optional[Dict[str, Any]] = None,
    language: Optional[str] = None,
    device: Optional[str] = None,
) -> None:
    queue = get_queue('default')
    meta_update = {
        "message": message,
        "progress": 100,
        "original_filename": original_filename,
        "language": language or result.get("language"),
        "device": device or result.get("device"),
        "summary": (result.get("text") or "")[:500],
        "audio_file": audio_file,
    }
    queue.update_job_meta(job_id, meta_update)

    try:
        upsert_job_record({
            "job_id": job_id,
            "filename": original_filename,
            "media_path": (audio_file.get("path") if isinstance(audio_file, dict) else None),
            "media_kind": None,
            "status": "completed",
            "language": language or result.get("language"),
            "device": device or result.get("device"),
            "summary": (result.get("text") or "")[:500],
            "transcript_json": result,
            "transcript_text": result.get("text"),
            "segment_count": len(result.get("segments") or []),
            "duration": result.get("audio_duration"),
        })
    except Exception as exc:
        logger.debug("Failed to upsert job record %s: %s", job_id, exc)


def mark_failed(*, job_id: str, original_filename: str, message: str) -> None:
    queue = get_queue('default')
    meta_update = {
        "message": message,
        "progress": -1,
        "original_filename": original_filename,
    }
    queue.update_job_meta(job_id, meta_update)
    try:
        upsert_job_record({
            "job_id": job_id,
            "filename": original_filename,
            "status": "failed",
            "summary": message,
        })
    except Exception as exc:
        logger.debug("Failed to upsert failed job record %s: %s", job_id, exc)


def remove_entry(job_id: str) -> None:
    queue = get_queue('default')
    queue.remove_job(job_id)
    try:
        with _connect() as conn:
            conn.execute("DELETE FROM job_records WHERE job_id = ?", (job_id,))
            conn.commit()
    except Exception as exc:
        logger.debug("Failed to remove job record %s: %s", job_id, exc)


def get_entry(job_id: str) -> Optional[Dict[str, Any]]:
    record = get_job_record(job_id)
    if record:
        status = record.get("status") or "completed"
        normalized_status = status.lower()
        progress = 100 if normalized_status in FINISHED_STATES else (-1 if normalized_status in FAILED_STATES else 0)
        entry = {
            "job_id": job_id,
            "status": status,
            "message": "",
            "created_at": _ts_to_iso(record.get("created_at")),
            "completed_at": _ts_to_iso(record.get("updated_at")),
            "original_filename": record.get("filename") or job_id,
            "audio_file": {
                "name": record.get("filename") or job_id,
                "path": record.get("media_path"),
                "size": record.get("media_size"),
                "hash": record.get("media_hash"),
                "mtime": record.get("media_mtime"),
            },
            "summary": record.get("summary") or (record.get("transcript_text") or "")[:500],
            "progress": progress,
            "media_path": record.get("media_path"),
            "media_kind": record.get("media_kind"),
            "media_hash": record.get("media_hash"),
            "media_size": record.get("media_size"),
            "media_mtime": record.get("media_mtime"),
            "media_invalid": record.get("media_invalid"),
            "ui_state": record.get("ui_state"),
        }
        return entry
    return None
