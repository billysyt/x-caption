#!/usr/bin/env python3
"""
Native configuration module
Handles paths, settings, and environment for bundled application
"""
import os
import sys
import shutil
import time
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

# Application version
VERSION = "0.1.0"

_ENV_READY = False


def startup_profile_enabled() -> bool:
    return bool(os.environ.get("XCAPTION_STARTUP_PROFILE"))


def _log_startup_timing(label: str, start: float) -> None:
    if startup_profile_enabled():
        elapsed = time.perf_counter() - start
        print(f"[STARTUP] {label}: {elapsed:.3f}s")


def is_frozen():
    """Check if running as PyInstaller bundle"""
    # Check multiple indicators that we're running as a bundle

    # PyInstaller sets sys.frozen
    if getattr(sys, 'frozen', False):
        return True

    # Check if we're running from inside a .app bundle (macOS)
    if sys.platform == 'darwin':
        exe_path = Path(sys.executable)
        # If executable is inside .app/Contents/MacOS/, we're bundled
        if '.app/Contents/MacOS' in str(exe_path):
            return True

    # Check if sys._MEIPASS exists (PyInstaller temporary folder)
    if hasattr(sys, '_MEIPASS'):
        return True

    return False


def get_bundle_dir() -> Path:
    """Get the bundle directory (where bundled resources are)"""
    if is_frozen():
        # Running as PyInstaller bundle
        # Try _MEIPASS first (standard PyInstaller location)
        if hasattr(sys, '_MEIPASS'):
            return Path(sys._MEIPASS)

        # For macOS .app bundles without _MEIPASS, use Resources directory
        if sys.platform == 'darwin' and '.app/Contents/MacOS' in str(sys.executable):
            # Executable is at X-Caption.app/Contents/MacOS/x-caption
            # Resources are at X-Caption.app/Contents/Resources/
            exe_path = Path(sys.executable)
            resources_dir = exe_path.parent.parent / 'Resources'
            if resources_dir.exists():
                return resources_dir

        # Fallback: use directory containing executable
        return Path(sys.executable).parent
    else:
        # Running in development mode
        return Path(__file__).parent


def get_data_dir() -> Path:
    """Get the application data directory (for user data, databases, models)"""
    if is_frozen():
        # Production: Use user's home directory
        if sys.platform == 'win32':
            # Windows: C:\Users\<username>\AppData\Local\X-Caption
            data_dir = Path(os.environ.get('LOCALAPPDATA', Path.home() / 'AppData' / 'Local')) / 'X-Caption'
        elif sys.platform == 'darwin':
            # macOS: ~/Library/Application Support/X-Caption
            data_dir = Path.home() / 'Library' / 'Application Support' / 'X-Caption'
        else:
            # Linux: ~/.local/share/x-caption
            data_dir = Path.home() / '.local' / 'share' / 'x-caption'
    else:
        # Development: Use local directory
        data_dir = Path(__file__).parent / 'data'

    # Create directory if it doesn't exist
    data_dir.mkdir(parents=True, exist_ok=True)

    return data_dir


def get_models_dir() -> Path:
    """Return the writable models directory (downloads go here)."""
    env_path = os.environ.get('XCAPTION_MODELS_DIR')
    if env_path:
        path = Path(env_path).expanduser()
        path.mkdir(parents=True, exist_ok=True)
        return path
    return get_data_dir()


def get_models_dir_lazy() -> Path:
    """Return the models directory without any extra work."""
    return get_models_dir()


def get_bundled_models_dir() -> Path | None:
    """Return bundled models directory if present (read-only)."""
    if not is_frozen():
        return None

    if sys.platform == 'darwin':
        models_path_pref = os.environ.get('XCAPTION_MODELS_PATH')
        if not models_path_pref:
            try:
                import plistlib
                plist_path = Path(sys.executable).parent.parent / 'Info.plist'
                if plist_path.exists():
                    with plist_path.open('rb') as plist_file:
                        info = plistlib.load(plist_file)
                    models_path_pref = info.get('X-CaptionModelsPath')
            except Exception as plist_exc:
                logger.warning(f"Failed to read Info.plist for models path: {plist_exc}")

        bundle_root = Path(sys.executable).parent.parent
        if models_path_pref:
            path_candidate = Path(models_path_pref)
            if not path_candidate.is_absolute():
                bundle_dir = bundle_root / path_candidate
            else:
                bundle_dir = path_candidate
        else:
            bundle_dir = bundle_root / 'Resources' / 'data' / 'models'

        if bundle_dir.exists():
            return bundle_dir

    bundle_dir = get_bundle_dir()
    bundled_models = bundle_dir / 'data' / 'models'
    if bundled_models.exists():
        return bundled_models
    return None


def _refresh_msvc_runtime():
    """Ensure PyQt uses an up-to-date MSVC runtime on Windows."""
    if sys.platform != 'win32' or not is_frozen():
        return

    bundle_dir = get_bundle_dir()
    qt_bin_dir = bundle_dir / 'PyQt5' / 'Qt5' / 'bin'
    if not qt_bin_dir.exists():
        return

    system32 = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32'
    runtime_cache = bundle_dir / 'msvc_runtime'
    candidates = [
        runtime_cache,
        bundle_dir,
        system32,
    ]

    for dll_name in ('msvcp140.dll', 'msvcp140_1.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'):
        src = None
        for candidate in candidates:
            candidate_path = candidate / dll_name
            if candidate_path.is_file():
                src = candidate_path
                break
            if candidate_path.is_dir():
                nested = candidate_path / dll_name
                if nested.is_file():
                    src = nested
                    break
                # Fallback to first DLL in the directory
                nested_match = next((file for file in candidate_path.glob("*.dll")), None)
                if nested_match:
                    src = nested_match
                    break
        if not src:
            continue

        dest = qt_bin_dir / dll_name
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
        except Exception as exc:
            logger.debug("Skipping MSVC runtime refresh for %s: %s", dll_name, exc)


def get_transcriptions_dir() -> Path:
    """Get the transcriptions output directory"""
    data_dir = get_data_dir()
    transcriptions_dir = data_dir / 'transcriptions'
    transcriptions_dir.mkdir(parents=True, exist_ok=True)
    return transcriptions_dir


def get_uploads_dir() -> Path:
    """Get the uploads directory"""
    data_dir = get_data_dir()
    uploads_dir = data_dir / 'uploads'
    uploads_dir.mkdir(parents=True, exist_ok=True)
    return uploads_dir


def get_templates_dir() -> Path:
    """Get the templates directory"""
    bundle_dir = get_bundle_dir()
    templates_dir = bundle_dir / 'templates'

    if not templates_dir.exists():
        # Fallback for development
        templates_dir = Path(__file__).parent / 'templates'

    return templates_dir


def get_static_dir() -> Path:
    """Get the static files directory"""
    bundle_dir = get_bundle_dir()
    static_dir = bundle_dir / 'static'

    if not static_dir.exists():
        # Fallback for development
        static_dir = Path(__file__).parent / 'static'

    return static_dir


def setup_environment():
    """Set up environment variables for the application"""
    global _ENV_READY
    if _ENV_READY:
        return
    start = time.perf_counter()

    # Log detection results for debugging
    frozen_state = is_frozen()
    logger.info(f"Application frozen state: {frozen_state}")
    logger.info(f"sys.frozen: {getattr(sys, 'frozen', False)}")
    logger.info(f"sys._MEIPASS: {hasattr(sys, '_MEIPASS')}")
    logger.info(f"sys.executable: {sys.executable}")

    _refresh_msvc_runtime()

    # Set application directories
    os.environ['XCAPTION_BUNDLE_DIR'] = str(get_bundle_dir())
    os.environ['XCAPTION_DATA_DIR'] = str(get_data_dir())
    os.environ['XCAPTION_MODELS_DIR'] = str(get_models_dir_lazy())
    os.environ['XCAPTION_TRANSCRIPTIONS_DIR'] = str(get_transcriptions_dir())
    os.environ['XCAPTION_UPLOADS_DIR'] = str(get_uploads_dir())

    # Set Python environment variables
    os.environ['PYTHONUNBUFFERED'] = '1'
    os.environ['PYTHONIOENCODING'] = 'utf-8'
    os.environ.setdefault('HF_HUB_OFFLINE', '1')
    os.environ.setdefault('TRANSFORMERS_OFFLINE', '1')

    # Platform-specific settings
    if sys.platform == 'darwin':  # macOS
        os.environ['OBJC_DISABLE_INITIALIZE_FORK_SAFETY'] = 'YES'
        os.environ['TOKENIZERS_PARALLELISM'] = 'false'
        os.environ.setdefault('OMP_NUM_THREADS', '4')
        os.environ.setdefault('MKL_NUM_THREADS', '4')
    elif sys.platform == 'win32':  # Windows
        os.environ['TOKENIZERS_PARALLELISM'] = 'false'
        os.environ['OMP_NUM_THREADS'] = '1'
    else:  # Linux
        os.environ.setdefault('TOKENIZERS_PARALLELISM', 'true')
        os.environ.setdefault('OMP_NUM_THREADS', '4')

    logger.info(f"Application bundle directory: {get_bundle_dir()}")
    logger.info(f"Application data directory: {get_data_dir()}")
    logger.info(f"Models directory: {get_models_dir_lazy()}")
    logger.info(f"Transcriptions directory: {get_transcriptions_dir()}")
    _ENV_READY = True
    _log_startup_timing("setup_environment total", start)



def get_config() -> dict:
    """Get application configuration"""
    return {
        'is_frozen': is_frozen(),
        'platform': sys.platform,
        'bundle_dir': str(get_bundle_dir()),
        'data_dir': str(get_data_dir()),
        'models_dir': str(get_models_dir()),
        'transcriptions_dir': str(get_transcriptions_dir()),
        'uploads_dir': str(get_uploads_dir()),
        'templates_dir': str(get_templates_dir()),
        'static_dir': str(get_static_dir()),
    }


if __name__ == '__main__':
    # Test configuration
    setup_environment()
    config = get_config()

    print("=" * 60)
    print("X-Caption Native Configuration")
    print("=" * 60)
    for key, value in config.items():
        print(f"{key:20s}: {value}")
    print("=" * 60)
