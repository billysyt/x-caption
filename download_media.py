from __future__ import annotations

import contextlib
import mimetypes
import subprocess
import uuid
import re
import base64
import time
import json
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Sequence
from urllib.parse import urlparse, unquote, parse_qs
import threading

from werkzeug.utils import secure_filename

from native_ffmpeg import get_ffmpeg_path


def _resolve_downloaded_media(
    downloads_dir: Path,
    download_id: str,
    allowed_extensions: Sequence[str],
) -> Path:
    candidates = [path for path in downloads_dir.glob(f"{download_id}.*") if path.is_file()]
    if not candidates:
        raise RuntimeError("Download completed but no media file was created.")
    normalized_extensions = {ext.lower().lstrip(".") for ext in allowed_extensions}
    allowed = [
        path
        for path in candidates
        if path.suffix.lstrip(".").lower() in normalized_extensions
    ]
    if allowed:
        candidates = allowed
    return max(candidates, key=lambda path: path.stat().st_mtime)


def _build_origin(url: str) -> Optional[str]:
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    if not parsed.scheme or not parsed.hostname:
        return None
    return f"{parsed.scheme}://{parsed.hostname}"


def _pick_format_selector(url: str) -> str:
    host = ""
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        host = ""
    if host.endswith("youtube.com") or host.endswith("youtu.be") or host.endswith("music.youtube.com"):
        # Prefer H.264 + AAC MP4 for maximum player compatibility on macOS/WebView.
        return (
            "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a][acodec^=mp4a]/"
            "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/"
            "best[ext=mp4][acodec!=none][vcodec^=avc1]/"
            "best[ext=mp4][acodec!=none]/best[ext=mp4]/best"
        )
    if "bilibili.com" in host or host.endswith(".bilibili.com") or host == "b23.tv":
        # Prefer H.264 + AAC for maximum player compatibility.
        return (
            "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/"
            "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
        )
    return "bestvideo*+bestaudio/best"


def _is_youtube_host(host: str) -> bool:
    return host.endswith("youtube.com") or host.endswith("youtu.be") or host.endswith("music.youtube.com")


def _probe_video_codec(path: Path) -> Optional[str]:
    try:
        ffmpeg_path = get_ffmpeg_path()
        process = subprocess.run([ffmpeg_path, "-i", str(path)], capture_output=True, text=True)
        output = (process.stderr or "") + (process.stdout or "")
        match = re.search(r"Video:\s*([^,\\s]+)", output)
        if match:
            return match.group(1).strip().lower()
    except Exception:
        return None
    return None


def _transcode_to_h264_aac(input_path: Path, output_path: Path) -> Optional[Path]:
    try:
        ffmpeg_path = get_ffmpeg_path()
        cmd = [
            ffmpeg_path,
            "-y",
            "-i",
            str(input_path),
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
        process = subprocess.run(cmd, capture_output=True, text=True)
        if process.returncode != 0 or not output_path.exists():
            return None
        return output_path
    except Exception:
        return None


def download_url_media(
    url: str,
    downloads_dir: Path,
    *,
    allowed_extensions: Sequence[str],
    preferred_stem: Optional[str] = None,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    download_id: Optional[str] = None,
    cancel_event: Optional[threading.Event] = None,
) -> Dict[str, Any]:
    try:
        from yt_dlp import YoutubeDL  # type: ignore
        from yt_dlp.extractor.common import InfoExtractor  # type: ignore
        from yt_dlp.utils import DownloadCancelled  # type: ignore
        from yt_dlp.utils import js_to_json  # type: ignore
    except Exception as exc:
        raise RuntimeError("URL download requires yt-dlp. Please install the dependency.") from exc

    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        host = ""

    impersonate_target = None
    extractor_args = None
    try:
        from yt_dlp.networking._curlcffi import CurlCFFIRH  # type: ignore
        from yt_dlp.networking.impersonate import ImpersonateTarget  # type: ignore

        if getattr(CurlCFFIRH, "supported_targets", None):
            preferred = next(
                (target for target in CurlCFFIRH.supported_targets if getattr(target, "client", None) == "chrome"),
                None
            )
            impersonate_target = preferred or CurlCFFIRH.supported_targets[0]
            if not isinstance(impersonate_target, ImpersonateTarget):
                impersonate_target = ImpersonateTarget.from_str(str(impersonate_target))
            extractor_args = {"generic": ["impersonate"]}
    except Exception:
        impersonate_target = None
        extractor_args = None

    class MissxxIE(InfoExtractor):
        _VALID_URL = r'https?://(?:www\.)?missav\.ws/(?:[^/?#]+/)*?(?P<id>[\w-]+)'

        def _real_extract(self, url):
            video_id = self._match_id(url)
            webpage = self._download_webpage(url, video_id)
            import re

            matches = list(re.finditer(r"m3u8\|([A-Za-z0-9_|-]+)", webpage))
            if not matches:
                raise RuntimeError("Unable to locate stream URL data.")

            chosen_words = None
            for match in matches:
                words = match.group(1).split("|")
                if words and words[0] == "m3u8":
                    words = words[1:]
                if not any(word in {"http", "https"} for word in words):
                    continue
                protocol_index = next(i for i, word in enumerate(words) if word in {"http", "https"})
                host_parts = words[5:protocol_index]
                if not host_parts:
                    continue
                if "surrit" in host_parts:
                    chosen_words = words
                    break
                if chosen_words is None:
                    chosen_words = words

            if not chosen_words:
                raise RuntimeError("Unable to resolve stream protocol.")

            url_words = chosen_words
            protocol_index = next(i for i, word in enumerate(url_words) if word in {"http", "https"})
            protocol = url_words[protocol_index]
            host_parts = url_words[5:protocol_index]
            if not host_parts:
                raise RuntimeError("Unable to resolve stream host.")

            m3u8_url_path = "-".join((url_words[0:5])[::-1])
            base_url_path = ".".join(host_parts[::-1])

            if "video" in url_words:
                video_index = url_words.index("video")
                video_format = url_words[video_index + 1] if video_index + 1 < len(url_words) else "1080p"
                formatted_url = f"{protocol}://{base_url_path}/{m3u8_url_path}/{video_format}/video.m3u8"
            else:
                formatted_url = f"{protocol}://{base_url_path}/{m3u8_url_path}/playlist.m3u8"

            formats = self._extract_m3u8_formats(formatted_url, video_id, "mp4", m3u8_id="hls")

            return {
                "id": video_id,
                "title": self._og_search_title(webpage),
                "description": self._og_search_description(webpage, default=""),
                "thumbnail": self._og_search_thumbnail(webpage, default=None),
                "formats": formats,
                "age_limit": 18,
            }

    class ThisxxIE(InfoExtractor):
        _VALID_URL = r'https?://(?:www\.)?thisav\.biz/(?:[a-z]{2}/)?thisav/(?P<id>[^/?#]+?)(?:\.html)?(?:[?#].*)?'
        _BASE62_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

        def _split_args(self, args_text: str) -> list[str]:
            parts: list[str] = []
            buf = ""
            depth = 0
            in_str = False
            esc = False
            quote = ""
            for ch in args_text:
                if in_str:
                    buf += ch
                    if esc:
                        esc = False
                    elif ch == "\\":
                        esc = True
                    elif ch == quote:
                        in_str = False
                else:
                    if ch in ('"', "'"):
                        in_str = True
                        quote = ch
                        buf += ch
                    elif ch in "([{":
                        depth += 1
                        buf += ch
                    elif ch in ")]}":
                        depth -= 1
                        buf += ch
                    elif ch == "," and depth == 0:
                        parts.append(buf.strip())
                        buf = ""
                    else:
                        buf += ch
            if buf.strip():
                parts.append(buf.strip())
            return parts

        def _decode_packed(self, packed: str) -> Optional[str]:
            end_idx = packed.find("</script>")
            if end_idx != -1:
                packed = packed[:end_idx]
            start_idx = packed.rfind("}(")
            if start_idx == -1:
                return None
            args_text = re.sub(r"\)\)\s*;?\s*$", "", packed[start_idx + 2:])
            parts = self._split_args(args_text)
            if len(parts) < 4:
                return None
            payload = parts[0]
            if payload and payload[0] in ('"', "'"):
                payload_val = bytes(payload[1:-1], "utf-8").decode("unicode_escape")
            else:
                payload_val = payload
            try:
                base = int(parts[1])
            except ValueError:
                return None
            km = re.match(r"(['\"])(.*)\1\.split\('\|'\)", parts[3])
            if not km:
                return None
            words = km.group(2).split("|")

            def base_n(num: int, base: int) -> str:
                digits = self._BASE62_ALPHABET
                if num == 0:
                    return "0"
                res = ""
                while num:
                    num, rem = divmod(num, base)
                    res = digits[rem] + res
                return res

            unpacked = payload_val
            for idx in range(len(words) - 1, -1, -1):
                if words[idx]:
                    token = base_n(idx, base)
                    unpacked = re.sub(r"\b" + re.escape(token) + r"\b", words[idx], unpacked)
            return unpacked

        def _extract_js_object(self, text: str, marker: str) -> Optional[str]:
            match = re.search(marker, text)
            if not match:
                return None
            start = text.find("{", match.end())
            if start == -1:
                return None
            depth = 0
            in_str = False
            esc = False
            quote = ""
            for idx in range(start, len(text)):
                ch = text[idx]
                if in_str:
                    if esc:
                        esc = False
                    elif ch == "\\":
                        esc = True
                    elif ch == quote:
                        in_str = False
                else:
                    if ch in ('"', "'"):
                        in_str = True
                        quote = ch
                    elif ch == "{":
                        depth += 1
                    elif ch == "}":
                        depth -= 1
                        if depth == 0:
                            return text[start:idx + 1]
            return None

        def _encrypt(self, value: str, key: int = 0x7B) -> str:
            data = value.encode("utf-8")
            data = bytes([b ^ key for b in data])
            num = 0
            for b in data:
                num = (num << 8) + b
            if num == 0:
                return self._BASE62_ALPHABET[0]
            encoded = ""
            while num > 0:
                num, rem = divmod(num, 62)
                encoded = self._BASE62_ALPHABET[rem] + encoded
            return encoded

        def _decode_if_needed(self, value: str, encrypt_flag: str) -> str:
            if encrypt_flag == "1":
                return unquote(value)
            if encrypt_flag == "2":
                try:
                    raw = base64.b64decode(value)
                    return unquote(raw.decode("utf-8", "ignore"))
                except Exception:
                    return value
            return value

        def _real_extract(self, url):
            video_id = self._match_id(url)
            webpage = self._download_webpage(url, video_id)

            packed_match = re.search(r"eval\(function\(p,a,c,k,e,d\)", webpage)
            unpacked = None
            if packed_match:
                packed_section = webpage[packed_match.start():]
                unpacked = self._decode_packed(packed_section)

            search_text = unpacked or webpage
            player_obj = self._extract_js_object(search_text, r"player_aaaa\s*=")
            if not player_obj:
                raise RuntimeError("Unable to locate player metadata.")
            player_data = self._parse_json(player_obj, video_id, transform_source=js_to_json)

            file_key = player_data.get("url")
            if not file_key:
                raise RuntimeError("Missing stream key for playback.")

            origin = "https://thisav.biz"
            headers = {
                "Referer": url,
                "Origin": origin,
            }

            token_data = self._download_json(
                f"{origin}/token.php?file={file_key}",
                video_id,
                headers=headers,
                note="Requesting stream token",
            )
            token = token_data.get("token")
            ts = token_data.get("ts")
            if not token or ts is None:
                raise RuntimeError("Unable to fetch stream token.")

            key = self._encrypt(f"{file_key}@{ts}")
            m3u8_data = self._download_json(
                f"{origin}/save_m3u8_cache.php?file={file_key}&token={token}&ts={ts}&sign={key}",
                video_id,
                headers=headers,
                note="Resolving stream URL",
            )
            m3u8_url = m3u8_data.get("m3u8_file")
            if not m3u8_url:
                raise RuntimeError("Unable to resolve stream URL.")
            if not m3u8_url.startswith("http"):
                m3u8_url = origin.rstrip("/") + "/" + m3u8_url.lstrip("/")
            if "sign=" not in m3u8_url:
                joiner = "&" if "?" in m3u8_url else "?"
                m3u8_url = f"{m3u8_url}{joiner}sign={key}"

            encrypt_flag = str(player_data.get("encrypt", "0"))
            m3u8_url = self._decode_if_needed(m3u8_url, encrypt_flag)

            formats = self._extract_m3u8_formats(m3u8_url, video_id, "mp4", m3u8_id="hls")

            thumbnail = player_data.get("poster")
            if thumbnail and not thumbnail.startswith("http"):
                thumbnail = origin.rstrip("/") + "/" + thumbnail.lstrip("/")

            return {
                "id": video_id,
                "title": self._og_search_title(webpage, default=video_id),
                "description": self._og_search_description(webpage, default=""),
                "thumbnail": thumbnail or self._og_search_thumbnail(webpage, default=None),
                "formats": formats,
                "age_limit": 18,
            }

    class AvxxIE(InfoExtractor):
        _VALID_URL = r'https?://(?:www\.)?av\.gl/(?:[a-z]{2}/)?videos/(?P<id>[^/?#]+)'
        _BASE62_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

        def _encrypt(self, value: str, key: int = 0x7B) -> str:
            data = value.encode("utf-8")
            data = bytes([b ^ key for b in data])
            num = 0
            for b in data:
                num = (num << 8) + b
            if num == 0:
                return self._BASE62_ALPHABET[0]
            encoded = ""
            while num > 0:
                num, rem = divmod(num, 62)
                encoded = self._BASE62_ALPHABET[rem] + encoded
            return encoded

        def _real_extract(self, url):
            from urllib.parse import urljoin, urlparse, parse_qs, quote

            video_id = self._match_id(url)
            webpage = self._download_webpage(url, video_id)

            iframe_src = self._search_regex(
                r'<iframe[^>]+src=[\"\\\']([^\"\\\']*/player/\\?[^\"\\\']+)[\"\\\']',
                webpage,
                "player iframe",
            )
            iframe_url = urljoin(url, iframe_src)
            parsed = urlparse(iframe_url)
            query = parse_qs(parsed.query)
            file_token = (query.get("src") or [None])[0]
            if not file_token:
                raise RuntimeError("Unable to locate stream token.")

            origin = _build_origin(url) or "https://av.gl"
            headers = {"Referer": url, "Origin": origin}

            token_data = self._download_json(
                f"{origin}/player/token.php?file={quote(file_token)}",
                video_id,
                headers=headers,
                note="Requesting stream token",
            )
            token = token_data.get("token")
            ts = token_data.get("ts")
            if not token or ts is None:
                raise RuntimeError("Unable to fetch stream token.")

            sign = self._encrypt(f"{file_token}@{int(time.time())}")
            m3u8_url = (
                f"{origin}/save_m3u8_cache.php?file={quote(file_token)}"
                f"&token={quote(str(token))}&ts={quote(str(ts))}&sign={quote(sign)}"
            )

            formats = self._extract_m3u8_formats(m3u8_url, video_id, "mp4", m3u8_id="hls")

            thumbnail = self._search_regex(
                r'itemprop=[\"\\\']thumbnailUrl[\"\\\']\\s+content=[\"\\\']([^\"\\\']+)[\"\\\']',
                webpage,
                "thumbnail",
                default=None,
            )

            return {
                "id": video_id,
                "title": self._og_search_title(webpage, default=video_id),
                "description": self._og_search_description(webpage, default=""),
                "thumbnail": thumbnail or self._og_search_thumbnail(webpage, default=None),
                "formats": formats,
                "age_limit": 18,
            }

    class DouxxIE(InfoExtractor):
        _VALID_URL = r'https?://(?:www\.)?douyin\.com/(?:(?:video|share/video)/(?P<id>\d+)|jingxuan|discover)(?:[/?#].*)?'

        def _extract_render_data(self, webpage: str) -> Optional[Dict[str, Any]]:
            match = re.search(
                r'<script[^>]+id=\"RENDER_DATA\"[^>]*>(?P<data>.*?)</script>',
                webpage,
                re.S,
            )
            if not match:
                return None
            raw = match.group("data").strip()
            if not raw:
                return None
            try:
                decoded = unquote(raw)
                return json.loads(decoded)
            except Exception:
                return None

        def _real_extract(self, url):
            parsed = urlparse(url)
            qs = parse_qs(parsed.query)
            modal_id = (qs.get("modal_id") or [None])[0]
            video_id = self._match_id(url) or modal_id or "douyin"

            webpage = self._download_webpage(url, video_id)
            render_data = self._extract_render_data(webpage)
            video_detail = None
            if render_data:
                video_detail = render_data.get("app", {}).get("videoDetail")

            if not video_detail and modal_id:
                fallback_url = f"https://www.douyin.com/video/{modal_id}"
                webpage = self._download_webpage(fallback_url, modal_id, note="Downloading fallback video page")
                render_data = self._extract_render_data(webpage)
                if render_data:
                    video_detail = render_data.get("app", {}).get("videoDetail")
                    video_id = modal_id

            if not video_detail:
                raise RuntimeError("Unable to locate video metadata.")

            video = video_detail.get("video") or {}
            desc = video_detail.get("desc") or video_detail.get("itemTitle") or ""
            title = (desc or str(video_id)).strip()

            formats = []
            for item in video.get("bitRateList") or []:
                play_addrs = item.get("playAddr") or []
                src = None
                if play_addrs and isinstance(play_addrs, list):
                    src = play_addrs[0].get("src")
                if not src:
                    continue
                tbr = item.get("bitRate")
                if isinstance(tbr, (int, float)):
                    tbr = tbr / 1000
                formats.append(
                    {
                        "url": src,
                        "format_id": item.get("gearName") or f"q{item.get('qualityType') or ''}",
                        "tbr": tbr,
                        "width": item.get("width"),
                        "height": item.get("height"),
                        "filesize": item.get("dataSize"),
                        "ext": item.get("format") or "mp4",
                    }
                )

            if not formats:
                for entry in video.get("playAddr") or []:
                    src = entry.get("src") if isinstance(entry, dict) else None
                    if not src:
                        continue
                    formats.append({"url": src, "ext": "mp4"})

            if not formats:
                raise RuntimeError("No playable video sources found.")

            self._sort_formats(formats)

            thumbnail = None
            cover_list = video.get("coverUrlList") or []
            if cover_list:
                thumbnail = cover_list[0]
            if not thumbnail:
                thumbnail = self._og_search_thumbnail(webpage, default=None)

            return {
                "id": video_detail.get("awemeId") or video_id,
                "title": title,
                "description": desc,
                "thumbnail": thumbnail,
                "formats": formats,
            }

    class ThrexxIE(InfoExtractor):
        _VALID_URL = r'https?://(?:www\.)?threads\.com/@[^/]+/post/(?P<id>[A-Za-z0-9_-]+)(?:/media)?'

        def _clean_url(self, value: str) -> str:
            cleaned = value.replace("\\u0026", "&").replace("\\/", "/")
            return cleaned

        def _extract_video_formats(self, webpage: str) -> list[Dict[str, Any]]:
            formats: list[Dict[str, Any]] = []
            for match in re.finditer(r'"video_versions"\s*:\s*\[(.*?)\]', webpage, re.S):
                block = match.group(1)
                for obj in re.finditer(r'\{[^{}]*"url"\s*:\s*"([^"]+)"[^{}]*\}', block):
                    blob = obj.group(0)
                    url_match = re.search(r'"url"\s*:\s*"([^"]+)"', blob)
                    if not url_match:
                        continue
                    raw_url = url_match.group(1)
                    url_value = self._clean_url(raw_url)
                    width = self._search_regex(r'"width"\s*:\s*(\d+)', blob, "width", default=None)
                    height = self._search_regex(r'"height"\s*:\s*(\d+)', blob, "height", default=None)
                    formats.append(
                        {
                            "url": url_value,
                            "width": int(width) if width else None,
                            "height": int(height) if height else None,
                            "ext": "mp4",
                        }
                    )
            return formats

        def _extract_image_url(self, webpage: str) -> Optional[str]:
            match = re.search(r'"image_versions2"\s*:\s*\{.*?"candidates"\s*:\s*\[(.*?)\]', webpage, re.S)
            if not match:
                return None
            block = match.group(1)
            url_match = re.search(r'"url"\s*:\s*"([^"]+)"', block)
            if not url_match:
                return None
            return self._clean_url(url_match.group(1))

        def _real_extract(self, url):
            video_id = self._match_id(url)
            webpage = self._download_webpage(url, video_id)

            formats = self._extract_video_formats(webpage)
            headers = {"Referer": url, "Origin": "https://www.threads.com"}
            for fmt in formats:
                fmt["http_headers"] = headers

            if not formats:
                image_url = self._extract_image_url(webpage)
                if not image_url:
                    raise RuntimeError("No media URLs found.")
                formats = [{"url": image_url, "ext": "jpg", "http_headers": headers}]

            self._sort_formats(formats)

            title = self._og_search_title(webpage, default=video_id)
            description = self._og_search_description(webpage, default="")
            thumbnail = self._og_search_thumbnail(webpage, default=None)

            return {
                "id": video_id,
                "title": title,
                "description": description,
                "thumbnail": thumbnail,
                "formats": formats,
            }

    class KuaxxIE(InfoExtractor):
        _VALID_URL = (
            r'https?://(?:www\.)?kuaishou\.com/'
            r'(?:(?:short-video|fw/short-video)/(?P<id>[\w-]+)|f/(?P<share>[\w-]+))'
        )

        _QUERY = (
            "query visionVideoDetail($photoId: String, $type: String, $page: String, $webPageArea: String) {"
            "  visionVideoDetail(photoId: $photoId, type: $type, page: $page, webPageArea: $webPageArea) {"
            "    status"
            "    type"
            "    author { id name }"
            "    photo {"
            "      id"
            "      duration"
            "      caption"
            "      likeCount"
            "      realLikeCount"
            "      coverUrl"
            "      photoUrl"
            "      photoH265Url"
            "      manifest {"
            "        adaptationSet {"
            "          representation {"
            "            id"
            "            url"
            "            backupUrl"
            "            height"
            "            width"
            "            avgBitrate"
            "            maxBitrate"
            "            qualityType"
            "            qualityLabel"
            "            frameRate"
            "          }"
            "        }"
            "      }"
            "      videoResource"
            "    }"
            "  }"
            "}"
        )

        def _add_representation(self, formats: list[Dict[str, Any]], rep: Dict[str, Any]) -> None:
            url_value = rep.get("url")
            if url_value:
                formats.append(
                    {
                        "url": url_value,
                        "format_id": rep.get("qualityType") or rep.get("qualityLabel") or "main",
                        "width": rep.get("width"),
                        "height": rep.get("height"),
                        "tbr": (rep.get("avgBitrate") or 0) / 1000 if rep.get("avgBitrate") else None,
                        "ext": "mp4",
                    }
                )
            for backup in rep.get("backupUrl") or []:
                if backup:
                    formats.append(
                        {
                            "url": backup,
                            "format_id": "backup",
                            "width": rep.get("width"),
                            "height": rep.get("height"),
                            "tbr": (rep.get("avgBitrate") or 0) / 1000 if rep.get("avgBitrate") else None,
                            "ext": "mp4",
                        }
                    )

        def _real_extract(self, url):
            match = re.match(self._VALID_URL, url)
            if not match:
                raise RuntimeError("Unsupported URL.")
            video_id = match.group("id")
            share_token = match.group("share")

            if not video_id:
                response = self._request_webpage(
                    url,
                    share_token or "share",
                    note="Resolving share link",
                    fatal=False,
                )
                final_url = None
                if response is not None:
                    with contextlib.suppress(Exception):
                        final_url = response.geturl()
                    if not final_url:
                        headers = getattr(response, "headers", None)
                        if headers:
                            final_url = headers.get("Location") or headers.get("location")
                if final_url:
                    id_match = re.search(r'/short-video/(?P<id>[\\w-]+)', final_url)
                    if id_match:
                        video_id = id_match.group("id")
                        url = final_url

            if not video_id:
                raise RuntimeError("Unable to resolve share link.")

            webpage = self._download_webpage(url, video_id)

            payload = {
                "operationName": "visionVideoDetail",
                "variables": {"photoId": video_id, "page": "detail"},
                "query": self._QUERY,
            }
            headers = {"Content-Type": "application/json", "Referer": url, "Origin": "https://www.kuaishou.com"}
            data = json.dumps(payload).encode("utf-8")
            response = self._download_json(
                "https://www.kuaishou.com/graphql",
                video_id,
                data=data,
                headers=headers,
            )

            if not response:
                raise RuntimeError("Unable to load media metadata.")
            if isinstance(response.get("data"), dict) and "result" in response["data"]:
                raise RuntimeError("Site verification required for this media source.")

            detail = (response.get("data") or {}).get("visionVideoDetail") or {}
            photo = detail.get("photo") or {}
            formats: list[Dict[str, Any]] = []

            photo_url = photo.get("photoUrl")
            if photo_url:
                formats.append({"url": photo_url, "format_id": "h264", "ext": "mp4"})
            photo_h265 = photo.get("photoH265Url")
            if photo_h265:
                formats.append({"url": photo_h265, "format_id": "hevc", "ext": "mp4"})

            manifest = photo.get("manifest") or {}
            for aset in manifest.get("adaptationSet") or []:
                for rep in aset.get("representation") or []:
                    if isinstance(rep, dict):
                        self._add_representation(formats, rep)

            if not formats:
                raise RuntimeError("No playable media sources found.")

            for fmt in formats:
                fmt["http_headers"] = headers

            self._sort_formats(formats)

            title = photo.get("caption") or self._og_search_title(webpage, default=video_id)
            thumbnail = photo.get("coverUrl") or None

            return {
                "id": photo.get("id") or video_id,
                "title": title,
                "description": photo.get("caption") or "",
                "thumbnail": thumbnail,
                "formats": formats,
            }

    downloads_dir.mkdir(parents=True, exist_ok=True)
    download_id = download_id or uuid.uuid4().hex
    outtmpl = str(downloads_dir / f"{download_id}.%(ext)s")

    def progress_hook(update: Dict[str, Any]) -> None:
        if cancel_event is not None and getattr(cancel_event, "is_set", None):
            if cancel_event.is_set():
                raise DownloadCancelled()
        if progress_callback:
            progress_callback(update)

    origin = _build_origin(url)
    headers = {"Referer": url}
    if origin:
        headers["Origin"] = origin

    ydl_opts = {
        "format": _pick_format_selector(url),
        "outtmpl": outtmpl,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "retries": 2,
        "merge_output_format": "mp4",
        "progress_hooks": [progress_hook],
        "http_headers": headers,
        "ffmpeg_location": get_ffmpeg_path(),
    }
    if extractor_args:
        ydl_opts["extractor_args"] = extractor_args
    if impersonate_target:
        ydl_opts["impersonate"] = impersonate_target

    if cancel_event is not None and cancel_event.is_set():
        raise DownloadCancelled()

    with YoutubeDL(ydl_opts) as ydl:
        missxx_ie = MissxxIE()
        thisxx_ie = ThisxxIE()
        avxx_ie = AvxxIE()
        douxx_ie = DouxxIE()
        threxx_ie = ThrexxIE()
        kuaxx_ie = KuaxxIE()
        ydl.add_info_extractor(missxx_ie)
        ydl.add_info_extractor(thisxx_ie)
        ydl.add_info_extractor(avxx_ie)
        ydl.add_info_extractor(douxx_ie)
        ydl.add_info_extractor(threxx_ie)
        ydl.add_info_extractor(kuaxx_ie)
        if douxx_ie.suitable(url):
            info = ydl.extract_info(url, download=True, ie_key=douxx_ie.IE_NAME)
        elif threxx_ie.suitable(url):
            info = ydl.extract_info(url, download=True, ie_key=threxx_ie.IE_NAME)
        elif kuaxx_ie.suitable(url):
            info = ydl.extract_info(url, download=True, ie_key=kuaxx_ie.IE_NAME)
        elif thisxx_ie.suitable(url):
            info = ydl.extract_info(url, download=True, ie_key=thisxx_ie.IE_NAME)
        elif missxx_ie.suitable(url):
            info = ydl.extract_info(url, download=True, ie_key=missxx_ie.IE_NAME)
        elif avxx_ie.suitable(url):
            info = ydl.extract_info(url, download=True, ie_key=avxx_ie.IE_NAME)
        else:
            info = ydl.extract_info(url, download=True)

    if not info:
        raise RuntimeError("Failed to fetch media metadata.")
    if "entries" in info:
        info = next((entry for entry in info.get("entries") or [] if entry), None)
        if not info:
            raise RuntimeError("No playable media entries found.")

    title = (info.get("title") or "download").strip()
    media_id = info.get("id")
    duration = info.get("duration")

    safe_title = secure_filename(title) or "download"
    safe_title = safe_title[:80].strip("-_") or "download"
    base_name = preferred_stem or safe_title
    base_name = secure_filename(base_name) or "download"
    base_name = base_name[:80].strip("-_") or "download"

    downloaded_path = _resolve_downloaded_media(downloads_dir, download_id, allowed_extensions)
    if _is_youtube_host(host):
        video_codec = _probe_video_codec(downloaded_path)
        if video_codec and not (video_codec.startswith("h264") or "avc1" in video_codec):
            compat_path = downloads_dir / f"{download_id}_compat.mp4"
            converted = _transcode_to_h264_aac(downloaded_path, compat_path)
            if converted:
                downloaded_path = converted
    final_name = f"{base_name}{downloaded_path.suffix}"
    final_path = downloads_dir / final_name
    if final_path.exists() and final_path.resolve() != downloaded_path.resolve():
        final_name = f"{base_name}-{download_id[:8]}{downloaded_path.suffix}"
        final_path = downloads_dir / final_name

    try:
        if downloaded_path.resolve() != final_path.resolve():
            downloaded_path.replace(final_path)
    except Exception:
        final_path = downloaded_path

    mime_type, _ = mimetypes.guess_type(str(final_path))
    size = None
    with contextlib.suppress(OSError):
        size = final_path.stat().st_size

    return {
        "file": {
            "path": str(final_path),
            "name": final_path.name,
            "size": size,
            "mime": mime_type or "application/octet-stream",
        },
        "source": {
            "url": url,
            "title": title,
            "id": media_id,
        },
        "duration_sec": duration if isinstance(duration, (int, float)) else None,
    }
