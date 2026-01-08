# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller specification for building the Windows desktop release.

This spec gathers the web UI, helper binaries, and the Whisper engine assets.

Usage (from project root on Windows):
    pyinstaller xcaption_native.spec --clean --noconfirm
"""

import os
from pathlib import Path
from PyInstaller.building.datastruct import TOC
from PyInstaller.utils.hooks import collect_data_files, collect_submodules
import sys

block_cipher = None

PROJECT_ROOT = Path.cwd()


def _add_if_exists(entries, source, target=None):
    source_path = PROJECT_ROOT / source
    if source_path.exists():
        entries.append((str(source_path), target or source.replace("\\", "/")))


# Static resources that must ship with the executable.
datas = []
_add_if_exists(datas, "templates", "templates")
_add_if_exists(datas, "static", "static")
# Note: sample folder excluded - not needed in production
# _add_if_exists(datas, "data/sample", "data/sample")
# _add_if_exists(datas, "sample", "sample")
_add_if_exists(datas, "ffmpeg", "ffmpeg")
_add_if_exists(datas, "whisper", "whisper")
_add_if_exists(datas, "merge", "merge")

icon_path = None
if sys.platform == "win32":
    candidate = PROJECT_ROOT / "assets" / "icon.ico"
    if candidate.exists():
        icon_path = str(candidate)
        datas.append((icon_path, "assets"))
elif sys.platform == "darwin":
    candidate = PROJECT_ROOT / "assets" / "icon.icns"
    if candidate.exists():
        icon_path = str(candidate)
        datas.append((icon_path, "assets"))

# Optional binaries (only populated on Windows if ffmpeg executables exist).
binaries = []
if sys.platform == "win32":
    ffmpeg_exe = PROJECT_ROOT / "ffmpeg" / "ffmpeg.exe"
    ffprobe_exe = PROJECT_ROOT / "ffmpeg" / "ffprobe.exe"
    if ffmpeg_exe.exists():
        binaries.append((str(ffmpeg_exe), "ffmpeg"))
    if ffprobe_exe.exists():
        binaries.append((str(ffprobe_exe), "ffmpeg"))

if sys.platform == "win32":
    system_dir = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32"
    for dll_name in ("msvcp140.dll", "msvcp140_1.dll", "vcruntime140.dll", "vcruntime140_1.dll"):
        dll_path = system_dir / dll_name
        if dll_path.exists():
            binaries.append((str(dll_path), f"msvc_runtime/{dll_name}"))

# Hidden imports that PyInstaller cannot detect automatically.
hiddenimports = [
    "engineio.async_drivers.threading",
    "numpy",
    "scipy",
    "soundfile",
]
hiddenimports += collect_submodules("yt_dlp")

# yt-dlp ships runtime assets used by extractors
datas += collect_data_files("yt_dlp")

a = Analysis(
    ["xcaption_launcher.py"],
    pathex=[str(PROJECT_ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tests",
        "pytest",
        "tensorflow",
        "torch",
        "torchvision",
        "pytorch_lightning",
        "lightning",
        "lightning_fabric",
        "lightning_utilities",
        "matplotlib.tests",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

if sys.platform == "win32":
    system_dir = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32"
    replacement_entries = []
    target_names = ("MSVCP140.dll", "MSVCP140_1.dll", "VCRUNTIME140.dll", "VCRUNTIME140_1.dll")
    remove_targets = {f"PyQt5{os.sep}Qt5{os.sep}bin{os.sep}{name}" for name in target_names}
    remove_targets.update({f"PyQt5/Qt5/bin/{name}" for name in target_names})
    filtered = [entry for entry in a.binaries if entry[0] not in remove_targets]

    for dll_name in ("MSVCP140.dll", "MSVCP140_1.dll", "VCRUNTIME140.dll", "VCRUNTIME140_1.dll"):
        dll_path = system_dir / dll_name.lower()
        if not dll_path.exists():
            dll_path = system_dir / dll_name
        if dll_path.exists():
            replacement_entries.append((f"PyQt5/Qt5/bin/{dll_name}", str(dll_path), "BINARY"))
    a.binaries = TOC(filtered + replacement_entries)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe_name = "X-Caption" if sys.platform == "win32" else "x-caption"

if sys.platform == "win32":
    # One-file Windows build (no _internal folder in dist).
    exe = EXE(
        pyz,
        a.scripts,
        a.binaries,
        a.zipfiles,
        a.datas,
        [],
        name=exe_name,
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=False,
        console=False,
        disable_windowed_traceback=False,
        argv_emulation=False,
        target_arch=None,
        codesign_identity=None,
        entitlements_file=None,
        icon=icon_path,
        exclude_binaries=False,
    )
else:
    exe = EXE(
        pyz,
        a.scripts,
        [],
        [],
        [],
        [],
        name=exe_name,
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=False,
        console=False,
        disable_windowed_traceback=False,
        argv_emulation=False,
        target_arch=None,
        codesign_identity=None,
        entitlements_file=None,
        icon=icon_path,
        exclude_binaries=True,
    )

    coll = COLLECT(
        exe,
        a.binaries,
        a.zipfiles,
        a.datas,
        strip=False,
        upx=False,
        upx_exclude=[],
        name=exe_name,
    )

# macOS .app bundle (only for macOS)
if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="X-Caption.app",
        icon=icon_path,
        bundle_identifier="com.billysyt.xcaption",
        version="1.0.0",
        info_plist={
            "CFBundleName": "X-Caption",
            "CFBundleDisplayName": "X-Caption",
            "CFBundleExecutable": "x-caption",
            "CFBundleIdentifier": "com.billysyt.xcaption",
            "CFBundleVersion": "0.1.0",
            "CFBundleShortVersionString": "0.1.0",
            "CFBundlePackageType": "APPL",
            "CFBundleSignature": "????",
            "LSMinimumSystemVersion": "10.13.0",
            "NSHighResolutionCapable": True,
            "NSSupportsAutomaticGraphicsSwitching": True,
            "NSHumanReadableCopyright": "Copyright © 2026 billysyt. All rights reserved.",
            "LSApplicationCategoryType": "public.app-category.productivity",
            "NSMicrophoneUsageDescription": "X-Caption needs microphone access for audio transcription.",
            "NSCameraUsageDescription": "X-Caption needs camera access for video processing.",
        },
    )
