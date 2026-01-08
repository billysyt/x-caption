FFmpeg Compliance (LGPL-only builds)
===================================
This file records FFmpeg compliance status for X-Caption distributions.
It is not legal advice.

Status (as of 2026-01-07)
-------------------------
- [x] Confirm the FFmpeg build is LGPL-only (no --enable-gpl, no --enable-nonfree).
- [x] Include the applicable FFmpeg license texts in the distribution package.
- [x] Include FFmpeg's LICENSE/NOTICE files from the FFmpeg source tree.
- [x] Record build details in ffmpeg/BUILD_INFO.txt and ffmpeg/BUILD_INFO_WINDOWS.txt.
- [x] Ensure relinking rights are preserved (dynamic linking on Windows build).
- [x] Replace bundled binaries per platform before shipping.

Evidence in this repo
---------------------
- macOS binaries present: ffmpeg/ffmpeg, ffmpeg/ffprobe
- Windows binaries present: ffmpeg/ffmpeg.exe, ffmpeg/ffprobe.exe
- Build records:
  - ffmpeg/BUILD_INFO.txt (macOS)
  - ffmpeg/BUILD_INFO_WINDOWS.txt (Windows)
- License files included from FFmpeg source (7.1.1):
  - ffmpeg/LGPLv2.1
  - ffmpeg/LGPLv3
