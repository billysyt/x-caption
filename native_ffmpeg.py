#!/usr/bin/env python3
"""
Native FFmpeg helper
Handles bundled FFmpeg binary for audio/video processing
"""
import os
import sys
import subprocess
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


def get_ffmpeg_path() -> str:
    """Get the path to FFmpeg binary"""
    from native_config import is_frozen, get_bundle_dir

    if is_frozen():
        # Running as PyInstaller bundle
        bundle_dir = get_bundle_dir()

        if sys.platform == 'win32':
            ffmpeg_path = bundle_dir / 'ffmpeg' / 'ffmpeg.exe'
        else:
            ffmpeg_path = bundle_dir / 'ffmpeg' / 'ffmpeg'

        if ffmpeg_path.exists():
            logger.info(f"Using bundled FFmpeg: {ffmpeg_path}")
            return str(ffmpeg_path)
        else:
            logger.warning(f"Bundled FFmpeg not found at {ffmpeg_path}, trying system FFmpeg")

    # Development mode or fallback: use system FFmpeg
    try:
        # Try to find system FFmpeg
        result = subprocess.run(
            ['ffmpeg', '-version'],
            capture_output=True,
            text=True,
            timeout=5
        )

        if result.returncode == 0:
            logger.info("Using system FFmpeg")
            return 'ffmpeg'

    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    # Last resort: check common installation paths, including local project copy
    common_paths = []

    if sys.platform == 'win32':
        common_paths = [
            Path('ffmpeg') / 'ffmpeg.exe',
            Path(__file__).resolve().parent / 'ffmpeg' / 'ffmpeg.exe',
            Path('C:/Program Files/ffmpeg/bin/ffmpeg.exe'),
            Path('C:/ffmpeg/bin/ffmpeg.exe'),
            Path(os.environ.get('PROGRAMFILES', 'C:/Program Files')) / 'ffmpeg' / 'bin' / 'ffmpeg.exe',
        ]
    elif sys.platform == 'darwin':
        common_paths = [
            Path('ffmpeg') / 'ffmpeg',
            Path(__file__).resolve().parent / 'ffmpeg' / 'ffmpeg',
            Path('/usr/local/bin/ffmpeg'),
            Path('/opt/homebrew/bin/ffmpeg'),
            Path('/usr/bin/ffmpeg'),
        ]
    else:  # Linux
        common_paths = [
            Path('ffmpeg') / 'ffmpeg',
            Path(__file__).resolve().parent / 'ffmpeg' / 'ffmpeg',
            Path('/usr/bin/ffmpeg'),
            Path('/usr/local/bin/ffmpeg'),
            Path('/snap/bin/ffmpeg'),
        ]

    for path in common_paths:
        if path.exists():
            logger.info(f"Found FFmpeg at: {path}")
            return str(path)

    # FFmpeg not found
    logger.error("FFmpeg not found! Please install FFmpeg or bundle it with the application.")
    raise FileNotFoundError(
        "FFmpeg not found. Please install FFmpeg:\n"
        "  Windows: choco install ffmpeg  OR  download from https://ffmpeg.org\n"
        "  macOS: brew install ffmpeg\n"
        "  Linux: sudo apt install ffmpeg"
    )


def get_ffprobe_path() -> str:
    """Get the path to FFprobe binary"""
    ffmpeg_path = get_ffmpeg_path()

    # FFprobe is usually in the same directory as FFmpeg
    ffmpeg_dir = Path(ffmpeg_path).parent

    if sys.platform == 'win32':
        ffprobe_path = ffmpeg_dir / 'ffprobe.exe'
    else:
        ffprobe_path = ffmpeg_dir / 'ffprobe'

    if ffprobe_path.exists():
        return str(ffprobe_path)

    # Try system ffprobe
    try:
        result = subprocess.run(
            ['ffprobe', '-version'],
            capture_output=True,
            text=True,
            timeout=5
        )

        if result.returncode == 0:
            return 'ffprobe'

    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    logger.warning("FFprobe not found, some features may not work")
    return 'ffprobe'  # Return default, may fail later


def setup_ffmpeg_environment():
    """Set up FFmpeg environment variables"""
    try:
        ffmpeg_path = get_ffmpeg_path()
        ffprobe_path = get_ffprobe_path()

        # Set environment variables that some libraries check
        os.environ['FFMPEG_BINARY'] = ffmpeg_path
        os.environ['FFPROBE_BINARY'] = ffprobe_path

        # Add FFmpeg directory to PATH
        ffmpeg_dir = str(Path(ffmpeg_path).parent)
        if ffmpeg_dir not in os.environ['PATH']:
            os.environ['PATH'] = ffmpeg_dir + os.pathsep + os.environ['PATH']

        logger.info("FFmpeg environment configured")
        return True

    except FileNotFoundError as e:
        logger.error(f"Failed to set up FFmpeg: {e}")
        return False


def test_ffmpeg() -> bool:
    """Test if FFmpeg is working"""
    try:
        ffmpeg_path = get_ffmpeg_path()

        result = subprocess.run(
            [ffmpeg_path, '-version'],
            capture_output=True,
            text=True,
            timeout=5
        )

        if result.returncode == 0:
            # Extract version info
            output_lines = result.stdout.splitlines()
            version_line = output_lines[0] if output_lines else "ffmpeg (version unknown)"
            logger.info(f"FFmpeg is working: {version_line}")

            # Warn if the build enables GPL/nonfree components (license impact for redistribution).
            config_line = next((line for line in output_lines if line.startswith("configuration:")), "")
            if config_line:
                logger.info("FFmpeg configuration: %s", config_line)
            if "--enable-gpl" in config_line or "--enable-nonfree" in config_line:
                logger.warning(
                    "FFmpeg build enables --enable-gpl or --enable-nonfree. "
                    "This affects redistribution licensing."
                )
            return True
        else:
            logger.error("FFmpeg test failed")
            return False

    except Exception as e:
        logger.error(f"FFmpeg test error: {e}")
        return False


def get_audio_duration(file_path: str) -> float:
    """Get audio file duration in seconds"""
    try:
        ffprobe_path = get_ffprobe_path()

        result = subprocess.run(
            [
                ffprobe_path,
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                file_path
            ],
            capture_output=True,
            text=True,
            timeout=10
        )

        if result.returncode == 0:
            duration = float(result.stdout.strip())
            return duration
        else:
            logger.error(f"Failed to get duration: {result.stderr}")
            return 0.0

    except Exception as e:
        logger.error(f"Error getting audio duration: {e}")
        return 0.0


def convert_to_wav(input_path: str, output_path: str) -> bool:
    """Convert audio file to WAV format"""
    try:
        ffmpeg_path = get_ffmpeg_path()

        result = subprocess.run(
            [
                ffmpeg_path,
                '-i', input_path,
                '-ar', '16000',  # 16kHz sample rate (good for speech)
                '-ac', '1',      # Mono
                '-c:a', 'pcm_s16le',  # 16-bit PCM
                '-y',            # Overwrite output file
                output_path
            ],
            capture_output=True,
            text=True,
            timeout=300  # 5 minutes timeout
        )

        if result.returncode == 0:
            logger.info(f"Converted {input_path} to {output_path}")
            return True
        else:
            logger.error(f"Conversion failed: {result.stderr}")
            return False

    except Exception as e:
        logger.error(f"Error converting audio: {e}")
        return False


if __name__ == '__main__':
    # Test FFmpeg setup
    print("=" * 60)
    print("FFmpeg Configuration Test")
    print("=" * 60)

    setup_ffmpeg_environment()

    print(f"FFmpeg path: {get_ffmpeg_path()}")
    print(f"FFprobe path: {get_ffprobe_path()}")

    if test_ffmpeg():
        print("✅ FFmpeg is working correctly!")
    else:
        print("❌ FFmpeg test failed!")

    print("=" * 60)
