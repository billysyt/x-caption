#!/usr/bin/env python3
"""
Native job handlers - lightweight, offline transcription pipeline for X-Caption.
Uses native_job_queue instead of Redis/RQ.
"""
from __future__ import annotations

import contextlib
import hashlib
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Optional, Tuple

import soundfile as sf

from whisper_cpp_runtime import transcribe_whisper_cpp, resolve_whisper_model

from native_config import get_uploads_dir, get_bundle_dir, setup_environment

try:
    from native_gpu_detection import get_gpu_device_label
except ImportError:
    def get_gpu_device_label() -> str:
        return "CPU"
from native_ffmpeg import get_ffmpeg_path, get_audio_duration
import native_history

setup_environment()

logger = logging.getLogger(__name__)

_VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".mkv", ".avi", ".flv", ".mpg", ".mpeg", ".webm"}
_ALWAYS_TRANSCODE_AUDIO = {".m4a", ".aac", ".opus", ".weba"}
_QUEUE_NAMES = ("high", "default", "low")


_CC_CREDIT_PATTERN = re.compile(r"^\s*CC[^:：]+[:：].+\s*$", re.IGNORECASE)
_WRITTEN_PREFIX_ENV = "XCAPTION_WRITTEN_PREFIX_AUDIO"
_SPOKEN_PREFIX_ENV = "XCAPTION_SPOKEN_PREFIX_AUDIO"
_DEFAULT_WRITTEN_PREFIX_RELATIVE = Path("merge") / "written.bin"
_DEFAULT_SPOKEN_PREFIX_RELATIVE = Path("merge") / "spoken.bin"
_PREFIX_BIN_MAGIC = b"XCAPTION_PREFIX_BIN_V1"
_PREFIX_BIN_KEY = b"XCAPTION_PREFIX_AUDIO_KEY_V1"
_PREFIX_SILENCE_SECONDS = 5.0
_DEFAULT_PREFIX_SECONDS = 15.0
_PREFIX_TRIM_MIN_DURATION = 0.2
_PREFIX_TRIM_BOUNDARY_TOLERANCE = 0.25
_PREFIX_RECOVERY_MAX_DURATION = 12.0


def _postprocess_caption_segments(
    segments: Iterable[Dict[str, Any]],
    language: Optional[str] = None,
) -> list[Dict[str, Any]]:
    normalized_language = (language or "").strip().lower()
    is_zh = normalized_language.startswith("zh")
    processed: list[Dict[str, Any]] = []
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        text = str(segment.get("text", "")).strip()
        if text and _CC_CREDIT_PATTERN.match(text):
            continue
        if text and "," in text:
            text = re.sub(r"\s*,\s*", " ", text).strip()
        if text and ("(" in text or ")" in text):
            text = text.replace("(", "").replace(")", "").strip()
            text = re.sub(r"\s{2,}", " ", text)
        if is_zh and text.endswith("。"):
            text = text[:-1].rstrip()

        updated = dict(segment)
        updated["text"] = text

        if is_zh and " " in text:
            start = float(updated.get("start", 0.0))
            end = float(updated.get("end", 0.0))
            duration = end - start
            tokens = [token for token in text.split() if token]
            if duration > 0.0 and len(tokens) >= 2:
                if duration >= 8.0 or len(tokens) >= 3:
                    total_chars = sum(len(token) for token in tokens)
                    if total_chars > 0:
                        cursor = start
                        for idx, token in enumerate(tokens):
                            if idx == len(tokens) - 1:
                                seg_end = end
                            else:
                                portion = sum(len(t) for t in tokens[: idx + 1]) / total_chars
                                seg_end = start + (duration * portion)
                            split_seg = dict(updated)
                            split_seg["start"] = max(0.0, float(cursor))
                            split_seg["end"] = max(split_seg["start"], float(seg_end))
                            split_text = token.strip()
                            if split_text.endswith("。"):
                                split_text = split_text[:-1].rstrip()
                            split_seg["text"] = split_text
                            processed.append(split_seg)
                            cursor = seg_end
                        continue

        processed.append(updated)
    for idx, segment in enumerate(processed):
        segment["id"] = idx
    return processed


def _should_apply_cantonese_prefix(language: str, chinese_style: Optional[str]) -> bool:
    if not chinese_style:
        return False
    normalized_style = chinese_style.strip().lower()
    if normalized_style not in {"written", "spoken"}:
        return False
    normalized_language = (language or "").strip().lower()
    return normalized_language in {"auto", "yue"}


def _xor_bytes(data: bytes, key: bytes) -> bytes:
    if not data:
        return data
    out = bytearray(len(data))
    counter = 0
    offset = 0
    while offset < len(data):
        digest = hashlib.sha256(key + counter.to_bytes(4, "little")).digest()
        for b in digest:
            if offset >= len(data):
                break
            out[offset] = data[offset] ^ b
            offset += 1
        counter += 1
    return bytes(out)


def _decode_prefix_binary(bin_path: Path, cleanup_paths: Optional[list]) -> Optional[Path]:
    try:
        data = bin_path.read_bytes()
    except Exception:
        logger.warning("Failed to read prefix binary %s", bin_path)
        return None
    if not data.startswith(_PREFIX_BIN_MAGIC):
        logger.warning("Prefix binary missing magic header: %s", bin_path)
        return None
    payload = data[len(_PREFIX_BIN_MAGIC):]
    decoded = _xor_bytes(payload, _PREFIX_BIN_KEY)
    temp_dir = Path(tempfile.mkdtemp(prefix="xcaption_prefix_bin_"))
    output_path = temp_dir / f"{bin_path.stem}.mp3"
    try:
        output_path.write_bytes(decoded)
    except Exception:
        logger.warning("Failed to decode prefix binary %s", bin_path)
        with contextlib.suppress(Exception):
            shutil.rmtree(temp_dir, ignore_errors=True)
        return None
    if cleanup_paths is not None:
        cleanup_paths.append(str(temp_dir))
    return output_path


def _resolve_prefix_path(chinese_style: Optional[str], cleanup_paths: Optional[list] = None) -> Optional[Path]:
    normalized_style = (chinese_style or "").strip().lower()
    if normalized_style == "written":
        env_key = _WRITTEN_PREFIX_ENV
        default_relative = _DEFAULT_WRITTEN_PREFIX_RELATIVE
    elif normalized_style == "spoken":
        env_key = _SPOKEN_PREFIX_ENV
        default_relative = _DEFAULT_SPOKEN_PREFIX_RELATIVE
    else:
        return None

    env_path = os.environ.get(env_key, "").strip()
    if env_path:
        candidate = Path(env_path)
        if not candidate.is_absolute():
            candidate = get_bundle_dir() / candidate
        if candidate.exists():
            if candidate.suffix.lower() == ".bin":
                return _decode_prefix_binary(candidate, cleanup_paths)
            return candidate
        logger.warning("Prefix audio not found at %s", candidate)

    default_path = get_bundle_dir() / default_relative
    if default_path.exists():
        if default_path.suffix.lower() == ".bin":
            decoded = _decode_prefix_binary(default_path, cleanup_paths)
            if decoded:
                return decoded
        return default_path
    mp3_fallback = default_path.with_suffix(".mp3")
    if mp3_fallback.exists():
        return mp3_fallback
    return None



def _concat_prefix_audio(
    *,
    job_id: str,
    prefix_path: Path,
    audio_path: Path,
    prefix_seconds: Optional[float] = None,
    silence_seconds: float = 0.0,
    cleanup_paths: Optional[list] = None,
) -> Optional[Path]:
    ffmpeg_path = get_ffmpeg_path()
    temp_dir = Path(tempfile.mkdtemp(prefix=f"xcaption_prefix_{job_id}_"))
    output_path = temp_dir / f"{job_id}_prefixed.wav"

    prefix_filter = "aformat=sample_fmts=s16:sample_rates=16000:channel_layouts=mono"
    if prefix_seconds and prefix_seconds > 0:
        prefix_filter = f"atrim=0:{prefix_seconds},{prefix_filter}"

    if silence_seconds and silence_seconds > 0:
        filter_str = (
            f"[0:a]{prefix_filter}[a0];"
            "[1:a]aformat=sample_fmts=s16:sample_rates=16000:channel_layouts=mono[a1];"
            f"anullsrc=r=16000:cl=mono:d={silence_seconds}[s];"
            "[a0][s][a1]concat=n=3:v=0:a=1[a]"
        )
    else:
        filter_str = (
            f"[0:a]{prefix_filter}[a0];"
            "[1:a]aformat=sample_fmts=s16:sample_rates=16000:channel_layouts=mono[a1];"
            "[a0][a1]concat=n=2:v=0:a=1[a]"
        )
    cmd = [
        ffmpeg_path,
        "-y",
        "-i",
        str(prefix_path),
        "-i",
        str(audio_path),
        "-filter_complex",
        filter_str,
        "-map",
        "[a]",
        "-acodec",
        "pcm_s16le",
        "-ac",
        "1",
        "-ar",
        "16000",
        str(output_path),
    ]
    process = subprocess.run(cmd, capture_output=True, text=True)
    if process.returncode != 0 or not output_path.exists():
        error_output = (process.stderr or process.stdout or "").strip()
        logger.warning("Failed to apply prefix audio: %s", error_output)
        with contextlib.suppress(Exception):
            shutil.rmtree(temp_dir, ignore_errors=True)
        return None

    if cleanup_paths is not None:
        cleanup_paths.append(str(temp_dir))
    return output_path


def _trim_prefixed_segments(
    segments: list[Dict[str, Any]],
    prefix_seconds: float,
    *,
    strict: bool = True,
) -> list[Dict[str, Any]]:
    if prefix_seconds <= 0:
        return segments
    trimmed: list[Dict[str, Any]] = []
    for segment in segments:
        start = float(segment.get("start", 0.0))
        end = float(segment.get("end", 0.0))
        if end <= prefix_seconds + _PREFIX_TRIM_MIN_DURATION:
            continue
        words = segment.get("words")
        if isinstance(words, list) and words:
            adjusted_words = _adjust_words_after_prefix(words, prefix_seconds)
            built = _build_segment_from_words(segment, adjusted_words)
            if not built:
                continue
            updated, _, _ = built
            trimmed.append(updated)
        else:
            if strict and start < prefix_seconds - _PREFIX_TRIM_BOUNDARY_TOLERANCE:
                continue
            updated = dict(segment)
            new_start = max(0.0, start - prefix_seconds)
            new_end = max(0.0, end - prefix_seconds)
            if new_end - new_start < _PREFIX_TRIM_MIN_DURATION:
                continue
            updated["start"] = new_start
            updated["end"] = new_end
            trimmed.append(updated)
    return trimmed


def _adjust_words_after_prefix(words: list[Dict[str, Any]], prefix_seconds: float) -> list[Dict[str, Any]]:
    adjusted_words: list[Dict[str, Any]] = []
    for word in words:
        if not isinstance(word, dict):
            continue
        w_start = word.get("start")
        w_end = word.get("end")
        if w_end is not None and float(w_end) <= prefix_seconds:
            continue
        new_word = dict(word)
        if w_start is not None:
            new_word["start"] = max(0.0, float(w_start) - prefix_seconds)
        if w_end is not None:
            new_word["end"] = max(0.0, float(w_end) - prefix_seconds)
        adjusted_words.append(new_word)
    return adjusted_words


def _build_segment_from_words(
    segment: Dict[str, Any],
    adjusted_words: list[Dict[str, Any]],
) -> Optional[tuple[Dict[str, Any], float, float]]:
    if not adjusted_words:
        return None
    new_start = float(adjusted_words[0].get("start", 0.0))
    new_end = float(adjusted_words[-1].get("end", 0.0))
    if new_end - new_start < _PREFIX_TRIM_MIN_DURATION:
        return None
    updated = dict(segment)
    updated["words"] = adjusted_words
    text_tokens = []
    for word in adjusted_words:
        token = word.get("word") or word.get("text")
        if token is None:
            continue
        text_tokens.append(str(token))
    if text_tokens:
        updated["text"] = "".join(text_tokens).strip()
    updated["start"] = new_start
    updated["end"] = new_end
    return updated, new_start, new_end


def _recover_first_segment_after_prefix(
    raw_segments: list[Dict[str, Any]],
    trimmed_segments: list[Dict[str, Any]],
    prefix_seconds: float,
) -> list[Dict[str, Any]]:
    if not raw_segments:
        return trimmed_segments
    if not trimmed_segments:
        first_start = None
    else:
        first_start = float(trimmed_segments[0].get("start", 0.0))
    if first_start is not None and first_start <= _PREFIX_TRIM_BOUNDARY_TOLERANCE:
        return trimmed_segments

    next_start = None
    if trimmed_segments:
        next_start = float(trimmed_segments[0].get("start", 0.0))

    best_candidate = None
    best_overlap = None
    for seg in raw_segments:
        if not isinstance(seg, dict):
            continue
        start = float(seg.get("start", 0.0))
        end = float(seg.get("end", 0.0))
        if end <= prefix_seconds:
            continue
        if start >= prefix_seconds:
            continue
        overlap = max(0.0, prefix_seconds - start)

        words = seg.get("words")
        if isinstance(words, list) and words:
            adjusted_words = _adjust_words_after_prefix(words, prefix_seconds)
            built = _build_segment_from_words(seg, adjusted_words)
            if not built:
                continue
            updated, new_start, new_end = built
        else:
            updated = dict(seg)
            new_start = 0.0
            new_end = max(0.0, end - prefix_seconds)
            if new_end - new_start < _PREFIX_TRIM_MIN_DURATION:
                continue
        if new_end > _PREFIX_RECOVERY_MAX_DURATION and next_start is None:
            continue
        if next_start is not None and new_end > next_start:
            new_end = max(new_start, next_start)
            if new_end - new_start < _PREFIX_TRIM_MIN_DURATION:
                continue

        updated["start"] = new_start
        updated["end"] = new_end
        updated["start"] = max(0.0, float(updated["start"]))
        updated["end"] = max(0.0, float(updated["end"]))
        if best_candidate is None or overlap < (best_overlap or 0.0):
            best_candidate = updated
            best_overlap = overlap

    if best_candidate is None:
        return trimmed_segments

    return [best_candidate, *trimmed_segments]


def _can_decode_with_soundfile(path: Path) -> bool:
    try:
        with sf.SoundFile(str(path)) as sound_file:
            return sound_file.frames > 0 and sound_file.channels > 0
    except Exception:
        return False


def _normalized_audio_filename(job_id: str) -> str:
    return f"{job_id}_normalized.wav"




def _prepare_audio_for_processing(
    job_id: str,
    file_path: str,
    progress_callback: Optional[Callable[[str, int], None]] = None,
) -> Tuple[Path, bool]:
    source_path = Path(file_path).resolve()
    suffix = source_path.suffix.lower()

    needs_conversion = False
    if suffix in _VIDEO_EXTENSIONS or suffix in _ALWAYS_TRANSCODE_AUDIO:
        needs_conversion = True
    elif not _can_decode_with_soundfile(source_path):
        needs_conversion = True

    if not needs_conversion:
        return source_path, False

    uploads_dir = get_uploads_dir()
    normalized_path = uploads_dir / _normalized_audio_filename(job_id)

    try:
        if normalized_path.exists():
            source_mtime = source_path.stat().st_mtime
            normalized_mtime = normalized_path.stat().st_mtime
            if normalized_mtime >= source_mtime:
                return normalized_path, True
    except OSError:
        pass

    if progress_callback:
        progress_callback("Converting media to supported format...", 7)

    ffmpeg_path = get_ffmpeg_path()
    normalized_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        ffmpeg_path,
        "-y",
        "-i",
        str(source_path),
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ac",
        "1",
        "-ar",
        "16000",
        str(normalized_path),
    ]
    process = subprocess.run(cmd, capture_output=True, text=True)

    if process.returncode != 0:
        error_output = (process.stderr or process.stdout or "").strip()
        logger.error("FFmpeg preprocessing failed for %s: %s", source_path, error_output)
        raise RuntimeError(
            f"FFmpeg failed to preprocess {source_path.name}. "
            "Ensure FFmpeg is installed and the media file is not corrupted."
        )

    if progress_callback:
        progress_callback("Audio converted successfully.", 9)

    return normalized_path, True


def update_job_progress(job_id: str, progress: int, message: str, extra_data: Optional[Dict[str, Any]] = None):
    """Update job progress for real-time monitoring."""
    try:
        from native_job_queue import get_queue

        for queue_name in _QUEUE_NAMES:
            try:
                queue = get_queue(queue_name)
                queue.update_job_meta(job_id, {
                    "progress": progress,
                    "message": message,
                    **(extra_data or {}),
                })
                logger.info("Job %s: %s%% - %s", job_id, progress, message)
                return
            except Exception:
                continue

    except Exception as e:
        logger.error("Failed to update job progress: %s", e)


def process_transcription_job(
    job_id: str,
    file_path: str,
    model_path: str = "whisper",
    language: str = "auto",
    chinese_style: Optional[str] = None,
    device: Optional[str] = None,
    compute_type: Optional[str] = None,
    vad_filter: bool = True,
    batch_size: int = 8,
    output_dir: Optional[str] = None,
    send_completion: bool = True,
    prepared_audio_path: Optional[str] = None,
    inference_audio_path: Optional[str] = None,
    audio_was_transcoded: Optional[bool] = None,
    original_audio_path: Optional[str] = None,
    cleanup_paths: Optional[list] = None,
    media_path: Optional[str] = None,
    media_kind: Optional[str] = None,
) -> Dict[str, Any]:
    """Process audio transcription job using the selected backend."""
    prepared_audio_path_obj: Optional[Path] = None
    was_transcoded = False
    if cleanup_paths is None:
        cleanup_paths = []
    try:
        start_time = time.time()
        update_job_progress(job_id, 0, "Starting transcription...", {"stage": "transcription"})

        output_dir_path = Path(tempfile.mkdtemp())

        update_job_progress(job_id, 5, "Preparing Whisper.cpp pipeline...", {"stage": "transcription"})

        if prepared_audio_path:
            prepared_audio_path_obj = Path(prepared_audio_path)
            was_transcoded = bool(audio_was_transcoded)
        else:
            update_job_progress(job_id, 6, "Verifying audio format...", {"stage": "transcription"})

            def preprocessing_update(message: str, approx_progress: int) -> None:
                update_job_progress(job_id, approx_progress, message, {"stage": "transcription"})

            prepared_audio_path_obj, was_transcoded = _prepare_audio_for_processing(
                job_id,
                file_path,
                preprocessing_update,
            )

        inference_path_obj = prepared_audio_path_obj
        if inference_audio_path:
            candidate = Path(inference_audio_path)
            if candidate.exists():
                inference_path_obj = candidate

        transcribe_path_obj = inference_path_obj
        prefix_trim_seconds = 0.0
        prefix_path = None
        prefix_label = None
        if _should_apply_cantonese_prefix(language, chinese_style):
            prefix_path = _resolve_prefix_path(chinese_style if chinese_style else "written", cleanup_paths)
            prefix_label = "Cantonese"

        if prefix_path and prefix_path.exists():
            update_job_progress(job_id, 8, f"Applying {prefix_label} prefix...", {"stage": "preprocessing"})
            prefix_duration = get_audio_duration(str(prefix_path))
            if not prefix_duration or prefix_duration <= 0:
                prefix_duration = _DEFAULT_PREFIX_SECONDS
            else:
                prefix_duration = min(prefix_duration, _DEFAULT_PREFIX_SECONDS)
            prefixed_path = _concat_prefix_audio(
                job_id=job_id,
                prefix_path=prefix_path,
                audio_path=inference_path_obj,
                prefix_seconds=prefix_duration,
                silence_seconds=_PREFIX_SILENCE_SECONDS,
                cleanup_paths=cleanup_paths,
            )
            if prefixed_path:
                transcribe_path_obj = prefixed_path
                prefix_trim_seconds = max(0.0, prefix_duration + _PREFIX_SILENCE_SECONDS)
        elif prefix_label:
            logger.warning("%s prefix audio not available; skipping prefix merge.", prefix_label)

        model_label = "Whisper.cpp"
        model_candidate = resolve_whisper_model(model_path)
        if model_candidate:
            model_label = f"Whisper.cpp ({model_candidate.name})"

        def whisper_progress(percent: int, message: str) -> None:
            try:
                numeric = int(percent)
            except (TypeError, ValueError):
                numeric = 0
            capped = max(10, min(numeric, 95))
            update_job_progress(job_id, capped, message, {"stage": "transcription"})

        language_for_whisper = language

        update_job_progress(job_id, 10, "Running Whisper transcription...", {"stage": "transcription"})
        transcription = transcribe_whisper_cpp(
            Path(transcribe_path_obj),
            model_path=model_path,
            language=language_for_whisper,
            output_dir=output_dir_path,
            progress_callback=whisper_progress,
        )
        device_label = get_gpu_device_label()

        raw_segments = transcription.get("segments") or []
        media_duration: Optional[float] = None
        try:
            media_duration = get_audio_duration(str(inference_path_obj))
            if not media_duration or media_duration <= 0:
                media_duration = None
        except Exception:
            media_duration = None
        segments = [
            {
                "id": idx,
                "start": float(segment.get("start", 0.0)),
                "end": float(segment.get("end", 0.0)),
                "text": str(segment.get("text", "")).strip(),
                "words": segment.get("words", []),
            }
            for idx, segment in enumerate(raw_segments)
        ]
        full_text = transcription.get("text", "").strip()
        detected_language = transcription.get("language") or (language or "auto")
        duration = transcription.get("duration")
        effective_prefix_trim = prefix_trim_seconds
        if not prefix_trim_seconds and isinstance(duration, (int, float)) and media_duration is not None:
            inferred_prefix = max(0.0, float(duration) - float(media_duration))
            if inferred_prefix > 0.5:
                effective_prefix_trim = inferred_prefix
        if effective_prefix_trim and isinstance(duration, (int, float)):
            duration = max(0.0, float(duration) - effective_prefix_trim)
        effective_duration: Optional[float] = None
        if isinstance(duration, (int, float)):
            effective_duration = float(duration)
        if media_duration is not None:
            effective_duration = media_duration

        if effective_prefix_trim:
            trimmed_segments = _trim_prefixed_segments(segments, effective_prefix_trim, strict=True)
            if not trimmed_segments and segments:
                logger.warning(
                    "Prefix trim removed all segments (%.2fs); retrying with lenient trim.",
                    effective_prefix_trim,
                )
                trimmed_segments = _trim_prefixed_segments(segments, effective_prefix_trim, strict=False)
            segments = _recover_first_segment_after_prefix(segments, trimmed_segments, effective_prefix_trim)

        if not segments and full_text:
            if effective_prefix_trim:
                full_text = ""
            else:
                segments = [
                    {
                        "id": 0,
                        "start": 0.0,
                        "end": round(float(effective_duration) if effective_duration else 0.0, 2),
                        "text": full_text,
                        "words": [],
                    }
                ]

        segments = _postprocess_caption_segments(segments, detected_language)
        full_text = " ".join([seg.get("text", "") for seg in segments if seg.get("text")]).strip()

        if not segments and not full_text:
            update_job_progress(job_id, 100, "No transcription generated", {"stage": "transcription"})
            result = {
                "job_id": job_id,
                "status": "completed",
                "file_path": file_path,
                "segments": [],
                "text": "",
                "language": detected_language or "auto",
                "transcription_time": round(time.time() - start_time, 2),
                "model": model_label,
                "device": device_label,
                "audio_was_transcoded": was_transcoded,
                "normalized_audio_path": str(prepared_audio_path_obj),
                "segment_count": 0,
            }
            if original_audio_path:
                result["original_audio_path"] = str(original_audio_path)
            return result

        transcription_time = time.time() - start_time
        result = {
            "job_id": job_id,
            "status": "completed",
            "file_path": media_path or file_path,
            "segments": segments,
            "text": full_text,
            "language": detected_language or "auto",
            "transcription_time": round(transcription_time, 2),
            "model": model_label,
            "device": device_label,
            "segment_count": len(segments),
        }
        if effective_duration is not None:
            try:
                result["audio_duration"] = round(float(effective_duration), 2)
            except Exception:
                pass

        try:
            existing_record = native_history.get_job_record(job_id)
            display_name = existing_record.get("display_name") if existing_record else None
            if not display_name:
                display_name = Path(media_path or file_path).stem
            native_history.upsert_job_record({
                "job_id": job_id,
                "filename": Path(media_path or file_path).name,
                "display_name": display_name,
                "media_path": media_path or file_path,
                "media_kind": media_kind,
                "status": "completed",
                "language": detected_language or "auto",
                "device": device_label,
                "summary": full_text[:500],
                "transcript_json": result,
                "transcript_text": full_text,
                "segment_count": len(segments),
                "duration": result.get("audio_duration"),
            })
        except Exception as history_error:
            logger.warning("Failed to store job record %s: %s", job_id, history_error)

        if send_completion:
            update_job_progress(job_id, 100, "Transcription completed successfully", {
                "result": result,
                "stage": "completed",
            })
            time.sleep(0.1)
        else:
            update_job_progress(job_id, 100, "Transcription completed", {
                "result": result,
                "stage": "transcription_complete",
            })

        return result
    except Exception as e:
        logger.error("Transcription job %s failed: %s", job_id, e)
        logger.error(traceback.format_exc())
        update_job_progress(job_id, -1, f"Transcription failed: {str(e)}", {
            "stage": "transcription",
            "error": str(e),
        })
        raise
    finally:
        with contextlib.suppress(Exception):
            shutil.rmtree(output_dir_path, ignore_errors=True)
        if cleanup_paths:
            for path in cleanup_paths:
                with contextlib.suppress(Exception):
                    target = Path(path)
                    if target.is_dir():
                        shutil.rmtree(target, ignore_errors=True)
                    else:
                        target.unlink()
        try:
            if was_transcoded and prepared_audio_path_obj:
                uploads_dir = get_uploads_dir().resolve()
                prepared_path = Path(prepared_audio_path_obj).resolve()
                if uploads_dir in prepared_path.parents:
                    prepared_path.unlink(missing_ok=True)
        except Exception:
            pass


def process_full_pipeline_job(
    job_id: str,
    file_path: str,
    model_path: str = "whisper",
    language: str = "auto",
    chinese_style: Optional[str] = None,
    device: Optional[str] = None,
    compute_type: Optional[str] = None,
    vad_filter: bool = True,
    output_dir: Optional[str] = None,
    original_filename: Optional[str] = None,
    uploaded_audio_path: Optional[str] = None,
    uploaded_audio_size: Optional[int] = None,
    prepared_audio_path: Optional[str] = None,
    audio_was_transcoded: Optional[bool] = None,
    original_audio_path: Optional[str] = None,
    cleanup_paths: Optional[list] = None,
    media_path: Optional[str] = None,
    media_kind: Optional[str] = None,
) -> Dict[str, Any]:
    """Process transcription pipeline."""
    reference_name = original_filename or (original_audio_path and Path(original_audio_path).name) or Path(file_path).name
    try:
        transcription_result = process_transcription_job(
            job_id=job_id,
            file_path=file_path,
            model_path=model_path,
            language=language,
            chinese_style=chinese_style,
            device=device,
            compute_type=compute_type,
            vad_filter=vad_filter,
            batch_size=8,
            send_completion=False,
            prepared_audio_path=prepared_audio_path,
            inference_audio_path=None,
            audio_was_transcoded=audio_was_transcoded,
            original_audio_path=original_audio_path or file_path,
            cleanup_paths=cleanup_paths,
            media_path=media_path or file_path,
            media_kind=media_kind,
        )

        audio_info: Dict[str, Any] = {"name": reference_name}
        playback_path = str(media_path or file_path)
        audio_info["path"] = playback_path

        reference_for_size = prepared_audio_path or uploaded_audio_path
        if uploaded_audio_size is not None and reference_for_size and playback_path == str(reference_for_size):
            audio_info["size"] = uploaded_audio_size
        else:
            with contextlib.suppress(OSError):
                audio_info["size"] = Path(playback_path).stat().st_size

        if original_audio_path:
            audio_info["original_path"] = str(original_audio_path)

        transcription_result["total_processing_time"] = round(
            transcription_result["transcription_time"], 2
        )

        completion_data = {
            "result": transcription_result,
            "stage": "pipeline",
            "audio_file": audio_info,
        }

        update_job_progress(job_id, 100, "All processing completed", completion_data)

        try:
            native_history.mark_completed(
                job_id=job_id,
                original_filename=reference_name,
                message="All processing completed",
                result=transcription_result,
                output_dir=None,
                audio_file=audio_info,
                language=transcription_result.get("language"),
                device=transcription_result.get("device"),
            )
        except Exception as history_error:
            logger.warning("Failed to persist history for job %s: %s", job_id, history_error)

        return transcription_result

    except Exception as e:
        logger.error("Full pipeline job %s failed: %s", job_id, e)
        logger.error(traceback.format_exc())
        try:
            native_history.mark_failed(
                job_id=job_id,
                original_filename=reference_name,
                message=str(e),
            )
        except Exception as history_error:
            logger.warning("Failed to record failed job %s in history: %s", job_id, history_error)
        raise
