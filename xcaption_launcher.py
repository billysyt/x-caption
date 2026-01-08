#!/usr/bin/env python3
"""
X-Caption Native Launcher
Single executable - no Docker, no Redis, no external dependencies.

This is the main entry point for the bundled application.
It serves the React UI and uses HTTP polling to emulate WebSocket-style updates.
"""
import os
import sys
import logging
import importlib
import threading
import time
import urllib.error
import urllib.request
import webbrowser
import ctypes
import tempfile
import warnings
import base64
import mimetypes
from pathlib import Path

IS_WINDOWS = sys.platform == "win32"


def _startup_profile_enabled() -> bool:
    return bool(os.environ.get("XCAPTION_STARTUP_PROFILE"))


def _log_startup_timing(label: str, start: float) -> None:
    if _startup_profile_enabled():
        elapsed = time.perf_counter() - start
        print(f"[STARTUP] {label}: {elapsed:.3f}s")


# Fix Windows console encoding issues
if IS_WINDOWS:
    try:
        os.system("chcp 65001 >nul")
    except Exception:
        pass


def _preload_system_msvc_runtime():
    if not IS_WINDOWS:
        return

    system_root = Path(os.environ.get("SystemRoot", r"C:\Windows"))
    system32 = system_root / "System32"
    for dll_name in ("msvcp140.dll", "msvcp140_1.dll", "vcruntime140.dll", "vcruntime140_1.dll"):
        dll_path = system32 / dll_name
        if dll_path.exists():
            try:
                ctypes.WinDLL(str(dll_path))
            except OSError:
                pass


_preload_system_msvc_runtime()


def _module_available(module_name: str) -> bool:
    try:
        importlib.import_module(module_name)
    except Exception:
        return False
    return True


CEF_AVAILABLE = False
QT_WEBENGINE_AVAILABLE = False
if sys.platform == "darwin":
    os.environ["PYWEBVIEW_GUI"] = "cocoa"
    if _module_available("cefpython3"):
        warnings.simplefilter("ignore", ResourceWarning)
        CEF_AVAILABLE = True

    if not CEF_AVAILABLE:
        if _module_available("PyQt6") and _module_available("PyQt6.QtWebEngineWidgets"):
            QT_WEBENGINE_AVAILABLE = True
else:
    CEF_AVAILABLE = False
    QT_WEBENGINE_AVAILABLE = False


_SINGLE_INSTANCE_HANDLE = None
_SINGLE_INSTANCE_FILE = None


def _ensure_single_instance():
    """
    Ensure only one X-Caption instance is running.
    Returns normally if ownership was acquired; raises RuntimeError otherwise.
    """
    global _SINGLE_INSTANCE_HANDLE, _SINGLE_INSTANCE_FILE

    if IS_WINDOWS:
        mutex_name = "Global\\X-CaptionSingleInstance"
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.CreateMutexW(None, False, mutex_name)
        if not handle:
            raise RuntimeError("Failed to create single-instance mutex.")

        ERROR_ALREADY_EXISTS = 183
        last_error = kernel32.GetLastError()
        if last_error == ERROR_ALREADY_EXISTS:
            kernel32.CloseHandle(handle)
            raise RuntimeError("Another X-Caption instance is already running.")

        _SINGLE_INSTANCE_HANDLE = handle
    else:
        import fcntl  # type: ignore

        lock_path = Path(tempfile.gettempdir()) / "x-caption_single_instance.lock"
        file_handle = open(lock_path, "w")
        try:
            fcntl.flock(file_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            file_handle.close()
            raise RuntimeError("Another X-Caption instance is already running.")

        _SINGLE_INSTANCE_FILE = file_handle
# Set up logging
def _configure_logging():
    """Configure logging to console only."""

    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # Avoid duplicate handlers if already configured
    if getattr(root_logger, "_xcaption_configured", False):
        return

    for handler in list(root_logger.handlers):
        root_logger.removeHandler(handler)

    # Console handler (stdout)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(formatter)

    root_logger.addHandler(console_handler)
    root_logger._xcaption_configured = True

_configure_logging()

logger = logging.getLogger("x-caption")


def print_banner():
    """Print startup banner."""
    lines = [
        "=" * 70,
        "X-Caption - Native Edition",
        "=" * 70,
        "    Professional Audio Transcription",
        "    No Docker | No Redis | No External Dependencies",
        "=" * 70,
        "",
    ]
    for line in lines:
        print(line)


def _force_exit(code: int = 0):
    """Force terminate the process (used when GUI loop doesn't exit cleanly)."""
    try:
        sys.stdout.flush()
        sys.stderr.flush()
    except Exception:
        pass
    os._exit(code)


def get_resource_path(relative_path: str) -> Path:
    """
    Resolve resources when running from source or a frozen PyInstaller bundle.
    """
    base_path = getattr(sys, "_MEIPASS", None)
    if base_path:
        return Path(base_path) / relative_path
    return Path(__file__).resolve().parent / relative_path


def check_and_setup_environment() -> bool:
    """Check and set up environment."""
    from native_config import get_data_dir, get_models_dir_lazy, setup_environment
    from native_ffmpeg import setup_ffmpeg_environment, test_ffmpeg

    overall_start = time.perf_counter()

    print("Setting up environment...")
    setup_start = time.perf_counter()
    setup_environment()
    _log_startup_timing("setup_environment", setup_start)

    # Display configuration (avoid heavy model sync on startup)
    print(f"Data directory: {get_data_dir()}")
    print(f"Models directory: {get_models_dir_lazy()}")

    # Display GPU information
    try:
        from native_gpu_detection import detect_gpu
        gpu_info = detect_gpu()
        print(f"Compute device: {gpu_info.get('device_label', 'CPU')}")
        if gpu_info.get("available"):
            print(f"  GPU acceleration: Enabled ({gpu_info.get('backend', 'unknown')} backend)")
        else:
            print("  GPU acceleration: Not available (using CPU)")
    except ImportError:
        print("Compute device: CPU (GPU detection not available)")
    except Exception as e:
        print(f"Compute device: CPU (GPU detection failed: {e})")

    # Set up FFmpeg
    print("Configuring FFmpeg...")
    ffmpeg_start = time.perf_counter()
    ffmpeg_ok = setup_ffmpeg_environment()
    _log_startup_timing("setup_ffmpeg_environment", ffmpeg_start)

    if not ffmpeg_ok:
        print("WARNING: FFmpeg not found!")
        print("   Transcription may not work without FFmpeg.")
        print()
        print("   Please install FFmpeg:")
        if IS_WINDOWS:
            print("     - Download from: https://ffmpeg.org/download.html")
            print("     - Or install with: choco install ffmpeg")
        elif sys.platform == "darwin":
            print("     - Install with: brew install ffmpeg")
        else:
            print("     - Install with: sudo apt install ffmpeg")
        print()

        # Ask user if they want to continue
        interactive = sys.stdin is not None and sys.stdin.isatty()
        if interactive:
            try:
                response = input("   Continue anyway? (y/n): ")
                if response.lower() != "y":
                    print("Exiting...")
                    sys.exit(1)
            except Exception:
                print("   Continuing without FFmpeg... (input unavailable)")
        else:
            print("   Continuing without FFmpeg... (non-interactive mode)")
    else:
        ffmpeg_test_start = time.perf_counter()
        if test_ffmpeg():
            print("FFmpeg is ready")
        _log_startup_timing("test_ffmpeg", ffmpeg_test_start)

    print()
    _log_startup_timing("check_and_setup_environment total", overall_start)
    return True


def patch_job_handlers():
    """Patch job handlers to emit WebSocket-style updates."""
    from native_web_server import publish_job_update
    import native_job_handlers

    original_update = native_job_handlers.update_job_progress

    def new_update_job_progress(
        job_id: str,
        progress: int,
        message: str,
        extra_data: dict | None = None,
    ):
        # Call original update
        original_update(job_id, progress, message, extra_data)

        # Also emit WebSocket-style update
        publish_job_update(
            job_id,
            "progress",
            {
                "job_id": job_id,
                "progress": progress,
                "message": message,
                "timestamp": time.time(),
                **(extra_data or {}),
            },
        )

    native_job_handlers.update_job_progress = new_update_job_progress
    logger.info("Job handlers patched for WebSocket emulation")


def start_worker_threads():
    """Start background worker threads."""
    from native_job_queue import start_worker

    print("[WORKER] Starting worker threads...")

    # Start 2 worker threads for processing jobs
    worker = start_worker(num_threads=2)

    print("[OK] Workers started")
    print()

    return worker


def start_web_server(port: int = 11440):
    """Start the web server in a background thread."""
    overall_start = time.perf_counter()
    import_start = time.perf_counter()
    native_web_server = importlib.import_module("native_web_server")
    _log_startup_timing("import native_web_server", import_start)
    create_app = native_web_server.create_app
    start_server = native_web_server.start_server

    print(f"[WEB] Starting web server on port {port}...")
    ui_mode = "React UI"
    if os.environ.get("XCAPTION_UI_DEV_URL"):
        ui_mode = "React UI via Vite dev server"
    print(f"[UI] {ui_mode} with WebSocket emulation (HTTP polling)")

    # Patch job handlers for real-time updates
    patch_start = time.perf_counter()
    patch_job_handlers()
    _log_startup_timing("patch_job_handlers", patch_start)

    # Create Flask app
    app_start = time.perf_counter()
    app = create_app()
    _log_startup_timing("create_app", app_start)

    # Start server in background thread
    server_thread = threading.Thread(
        target=start_server,
        args=(app, port, "127.0.0.1"),
        daemon=True,
    )
    server_thread.start()

    # Wait for server to actually be ready (not just started)
    health_url = f"http://127.0.0.1:{port}/health"
    import urllib.request
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    max_wait = 10.0
    start_time = time.time()

    while time.time() - start_time < max_wait:
        try:
            request = urllib.request.Request(health_url)
            with opener.open(request, timeout=1) as response:
                if response.status == 200:
                    break
        except:
            pass
        time.sleep(0.1)

    print("[OK] Web server started")
    print()
    _log_startup_timing("start_web_server total", overall_start)

    return server_thread


# Global menu handler to prevent garbage collection
_MENU_HANDLER = None
_MENU_HANDLER_CLASS = None


def _get_or_create_menu_handler_class():
    """Get or create the MenuHandler class (singleton pattern)."""
    global _MENU_HANDLER_CLASS

    if _MENU_HANDLER_CLASS is not None:
        return _MENU_HANDLER_CLASS

    try:
        import objc

        # Menu handler class that persists - must inherit from NSObject
        class MenuHandler(objc.lookUpClass("NSObject")):
            @objc.python_method
            def init(self):
                self = objc.super(MenuHandler, self).init()
                return self

            def showAbout_(self, sender):
                """Trigger About modal in React UI via JavaScript."""
                try:
                    logger.info("About menu clicked - triggering React modal")

                    # Use a background thread to avoid blocking the main thread
                    def trigger_modal():
                        try:
                            # Trigger the About modal by dispatching Redux action via JavaScript
                            js_code = """
                            (function() {
                                try {
                                    if (window.store && window.store.dispatch) {
                                        window.store.dispatch({ type: 'app/setShowAboutModal', payload: true });
                                        return true;
                                    }
                                    return false;
                                } catch (e) {
                                    console.error('Error dispatching about modal:', e);
                                    return false;
                                }
                            })();
                            """
                            # Find the pywebview window and execute JavaScript
                            import webview
                            windows = webview.windows
                            if windows and len(windows) > 0:
                                result = windows[0].evaluate_js(js_code)
                                logger.info(f"About modal triggered, result: {result}")
                            else:
                                logger.warning("No webview windows found to trigger About modal")
                        except Exception as e:
                            logger.error(f"Error in trigger_modal thread: {e}", exc_info=True)

                    # Run in background thread to avoid blocking
                    import threading
                    threading.Thread(target=trigger_modal, daemon=True).start()

                except Exception as e:
                    logger.error(f"Error triggering about modal: {e}", exc_info=True)

        _MENU_HANDLER_CLASS = MenuHandler
        return MenuHandler
    except Exception as exc:
        logger.error(f"Failed to create MenuHandler class: {exc}")
        return None


def setup_macos_menu():
    """Set up native macOS menu with About option."""
    global _MENU_HANDLER

    if sys.platform != "darwin":
        return

    try:
        from native_config import VERSION
        from AppKit import (
            NSApp,
            NSMenu,
            NSMenuItem,
        )
        import objc

        # Get or create the MenuHandler class
        MenuHandler = _get_or_create_menu_handler_class()
        if MenuHandler is None:
            logger.error("Could not create MenuHandler class")
            return

        # Create and retain handler if not already created
        if _MENU_HANDLER is None:
            _MENU_HANDLER = MenuHandler.alloc().init()

            # Verify handler can respond to selector
            if not _MENU_HANDLER.respondsToSelector_("showAbout:"):
                logger.warning("MenuHandler does not respond to showAbout: selector!")
            else:
                logger.info("MenuHandler successfully responds to showAbout: selector")

        # Create main menu bar
        main_menu = NSMenu.alloc().init()

        # Create app menu (first menu)
        app_menu_item = NSMenuItem.alloc().init()
        main_menu.addItem_(app_menu_item)

        # Create app submenu
        app_menu = NSMenu.alloc().init()
        app_menu_item.setSubmenu_(app_menu)

        # Add About menu item - DON'T use the standard "orderFrontStandardAboutPanel:" action
        # because that shows Python's About dialog. Use our custom action instead.
        about_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "About X-Caption",
            "showAbout:",
            ""
        )
        about_item.setTarget_(_MENU_HANDLER)
        app_menu.addItem_(about_item)

        logger.info(f"About menu item created with target: {_MENU_HANDLER}, action: showAbout:")

        # Add separator
        app_menu.addItem_(NSMenuItem.separatorItem())

        # Add Hide X-Caption (Cmd+H)
        hide_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "Hide X-Caption",
            "hide:",
            "h"
        )
        app_menu.addItem_(hide_item)

        # Add Hide Others (Cmd+Opt+H)
        hide_others_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "Hide Others",
            "hideOtherApplications:",
            "h"
        )
        hide_others_item.setKeyEquivalentModifierMask_(
            1 << 18 | 1 << 19  # NSEventModifierFlagOption | NSEventModifierFlagCommand
        )
        app_menu.addItem_(hide_others_item)

        # Add Show All
        show_all_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "Show All",
            "unhideAllApplications:",
            ""
        )
        app_menu.addItem_(show_all_item)

        # Add separator
        app_menu.addItem_(NSMenuItem.separatorItem())

        # Add Quit X-Caption (Cmd+Q)
        quit_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "Quit X-Caption",
            "terminate:",
            "q"
        )
        app_menu.addItem_(quit_item)

        # Set as the main menu
        NSApp.setMainMenu_(main_menu)

        # Verify what was actually set
        try:
            current_menu = NSApp.mainMenu()
            if current_menu:
                first_item = current_menu.itemAtIndex_(0)
                if first_item:
                    submenu = first_item.submenu()
                    if submenu:
                        about_item_check = submenu.itemAtIndex_(0)
                        if about_item_check:
                            logger.info(f"Verified: Menu item title is '{about_item_check.title()}'")
                            logger.info(f"Verified: Menu item action is '{about_item_check.action()}'")
                            logger.info(f"Verified: Menu item target is '{about_item_check.target()}'")
        except Exception as e:
            logger.debug(f"Could not verify menu: {e}")

        logger.info("macOS native menu configured successfully")
    except Exception as exc:
        logger.warning("Failed to set up macOS menu: %s", exc)


def open_browser(port: int = 11440, width: int = 1280, height: int = 800) -> str:
    """Open native window with embedded Chromium, falling back to system browser."""
    from native_config import VERSION

    host = "127.0.0.1"
    url = f"http://{host}:{port}"
    dev_url = os.environ.get("XCAPTION_UI_DEV_URL")
    if dev_url:
        url = dev_url.strip()
    icon_filename = "assets/icon.ico" if IS_WINDOWS else "assets/icon.icns"
    icon_path = get_resource_path(icon_filename)

    print(f"[UI] Opening embedded window: {url}")
    if sys.platform == "darwin":
        if CEF_AVAILABLE:
            print("[INFO] Using CEF backend for embedded Chromium window.")
        elif QT_WEBENGINE_AVAILABLE:
            print("[INFO] Using PyQt6 WebEngine backend for embedded Chromium window.")
        else:
            note = "Install 'cefpython3' (Python 3.10/3.11) or 'PyQt6'+'PyQt6-WebEngine' to enable Chromium embedding on macOS."
            print(f"[INFO] No Chromium backend detected. {note}")

    placeholder_html = """
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>X-Caption Loading</title>
  <style>
    :root { color-scheme: dark; }
    body {
      background: #10131a;
      color: #f5f7fb;
      font-family: "Segoe UI", "Helvetica Neue", sans-serif;
      margin: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      text-align: center;
    }
    .spinner {
      width: 56px;
      height: 56px;
      border: 6px solid rgba(255, 255, 255, 0.12);
      border-top-color: #4dabf7;
      border-radius: 50%;
      animation: spin 0.9s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="spinner"></div>
</body>
</html>
"""


    try:
        import webview  # type: ignore

        class EmbeddedBridge:
            """Expose native helpers to the web UI when running inside pywebview."""

            def __init__(self, webview_module):
                self._webview = webview_module
                self._window = None

            def attach(self, window):
                self._window = window

            def save_transcript(self, filename: str, content: str):
                """
                Save transcript content through a native save dialog.
                Returns a dict so the front-end can differentiate success/cancel/error.
                """
                if not self._window:
                    return {"success": False, "error": "window_not_ready"}

                safe_name = (filename or "transcript.txt").strip() or "transcript.txt"

                # Detect file type based on extension to set appropriate file type filter
                if safe_name.endswith('.srt'):
                    file_types = ("SRT subtitle files (*.srt)", "All files (*.*)")
                else:
                    file_types = ("Text files (*.txt)", "All files (*.*)")

                try:
                    dialog_result = self._window.create_file_dialog(
                        self._webview.SAVE_DIALOG,
                        save_filename=safe_name,
                        file_types=file_types,
                    )
                except TypeError:
                    # Older runtimes may not accept file_types
                    dialog_result = self._window.create_file_dialog(
                        self._webview.SAVE_DIALOG,
                        save_filename=safe_name,
                    )

                if not dialog_result:
                    return {"success": False, "cancelled": True}

                if isinstance(dialog_result, (list, tuple)):
                    target_path = dialog_result[0]
                else:
                    target_path = dialog_result

                if not target_path:
                    return {"success": False, "error": "invalid_path"}

                try:
                    Path(target_path).write_text(str(content), encoding="utf-8")
                except Exception as exc:  # pragma: no cover - defensive
                    logger.error("Failed to write transcript: %s", exc)
                    return {"success": False, "error": str(exc)}

                logger.info("Transcript saved via native dialog: %s", target_path)
                return {"success": True, "path": str(target_path)}

            def saveTranscript(self, filename: str, content: str):
                """Alias for camelCase access from JavaScript."""
                return self.save_transcript(filename, content)

            def _read_file_payload(self, target_path: str):
                try:
                    path = Path(target_path).expanduser()
                except Exception:
                    return {"success": False, "error": "invalid_path"}

                if not path.exists() or not path.is_file():
                    return {"success": False, "error": "file_not_found"}

                try:
                    data = path.read_bytes()
                except Exception as exc:  # pragma: no cover - defensive
                    return {"success": False, "error": str(exc)}

                mime_type, _ = mimetypes.guess_type(str(path))
                return {
                    "success": True,
                    "file": {
                        "name": path.name,
                        "data": base64.b64encode(data).decode("ascii"),
                        "mime": mime_type or "application/octet-stream",
                        "size": path.stat().st_size,
                    },
                }

            def open_media_dialog(self):
                if not self._window:
                    return {"success": False, "error": "window_not_ready"}

                media_extensions = {
                    "mp4",
                    "m4v",
                    "mov",
                    "mkv",
                    "avi",
                    "webm",
                    "flv",
                    "mpg",
                    "mpeg",
                    "mp3",
                    "wav",
                    "flac",
                    "m4a",
                    "aac",
                    "ogg",
                    "opus",
                }
                media_pattern = ";".join(f"*.{ext}" for ext in sorted(media_extensions))
                file_types = ((f"Media files ({media_pattern})", media_pattern),)
                try:
                    dialog_result = self._window.create_file_dialog(
                        self._webview.OPEN_DIALOG,
                        allow_multiple=False,
                        file_types=file_types,
                    )
                except TypeError:
                    dialog_result = self._window.create_file_dialog(
                        self._webview.OPEN_DIALOG,
                        allow_multiple=False,
                    )

                if not dialog_result:
                    return {"success": False, "cancelled": True}

                if isinstance(dialog_result, (list, tuple)):
                    target_path = dialog_result[0]
                else:
                    target_path = dialog_result

                if not target_path:
                    return {"success": False, "error": "invalid_path"}

                suffix = Path(str(target_path)).suffix.lower().lstrip(".")
                if suffix not in media_extensions:
                    return {"success": False, "error": "unsupported_file"}

                try:
                    file_size = Path(str(target_path)).stat().st_size
                except Exception:
                    file_size = None

                mime_type, _ = mimetypes.guess_type(str(target_path))
                return {
                    "success": True,
                    "file": {
                        "name": Path(str(target_path)).name,
                        "path": str(target_path),
                        "mime": mime_type or "application/octet-stream",
                        "size": file_size,
                    },
                    "mode": "path",
                }

            def openMediaDialog(self):
                """Alias for camelCase access from JavaScript."""
                return self.open_media_dialog()

            def open_directory_dialog(self):
                if not self._window:
                    return {"success": False, "error": "window_not_ready"}

                dialog_type = getattr(self._webview, "FOLDER_DIALOG", None)
                if dialog_type is None:
                    return {"success": False, "error": "unsupported"}

                try:
                    dialog_result = self._window.create_file_dialog(
                        dialog_type,
                        allow_multiple=False,
                    )
                except TypeError:
                    dialog_result = self._window.create_file_dialog(dialog_type)

                if not dialog_result:
                    return {"success": False, "cancelled": True}

                if isinstance(dialog_result, (list, tuple)):
                    target_path = dialog_result[0]
                else:
                    target_path = dialog_result

                if not target_path:
                    return {"success": False, "error": "invalid_path"}

                return {"success": True, "path": str(target_path)}

            def openDirectoryDialog(self):
                """Alias for camelCase access from JavaScript."""
                return self.open_directory_dialog()

            def read_file(self, target_path: str):
                """Read a file by path (used for large local files)."""
                return self._read_file_payload(target_path)

            def readFile(self, target_path: str):
                """Alias for camelCase access from JavaScript."""
                return self.read_file(target_path)

            def open_srt_dialog(self):
                if not self._window:
                    return {"success": False, "error": "window_not_ready"}

                file_types = (("SubRip files (*.srt)", "*.srt"),)
                try:
                    dialog_result = self._window.create_file_dialog(
                        self._webview.OPEN_DIALOG,
                        allow_multiple=False,
                        file_types=file_types,
                    )
                except TypeError:
                    dialog_result = self._window.create_file_dialog(
                        self._webview.OPEN_DIALOG,
                        allow_multiple=False,
                    )

                if not dialog_result:
                    return {"success": False, "cancelled": True}

                if isinstance(dialog_result, (list, tuple)):
                    target_path = dialog_result[0]
                else:
                    target_path = dialog_result

                if not target_path:
                    return {"success": False, "error": "invalid_path"}

                if not str(target_path).lower().endswith(".srt"):
                    return {"success": False, "error": "unsupported_file"}

                return self._read_file_payload(target_path)

            def openSrtDialog(self):
                """Alias for camelCase access from JavaScript."""
                return self.open_srt_dialog()

            def window_minimize(self):
                if not self._window:
                    return {"success": False, "error": "window_not_ready"}
                try:
                    if hasattr(self._window, "minimize"):
                        self._window.minimize()
                        return {"success": True}
                except Exception as exc:  # pragma: no cover - defensive
                    return {"success": False, "error": str(exc)}
                return {"success": False, "error": "unsupported"}

            def window_close(self):
                if not self._window:
                    return {"success": False, "error": "window_not_ready"}
                try:
                    if hasattr(self._webview, "destroy_window"):
                        self._webview.destroy_window(self._window)
                        threading.Timer(0.2, _force_exit).start()
                        return {"success": True}
                    if hasattr(self._window, "destroy"):
                        self._window.destroy()
                        threading.Timer(0.2, _force_exit).start()
                        return {"success": True}
                    if hasattr(self._window, "close"):
                        self._window.close()
                        threading.Timer(0.2, _force_exit).start()
                        return {"success": True}
                except Exception as exc:  # pragma: no cover - defensive
                    return {"success": False, "error": str(exc)}
                return {"success": False, "error": "unsupported"}

            def window_toggle_maximize(self):
                if not self._window:
                    return {"success": False, "error": "window_not_ready"}
                try:
                    is_maximized = None
                    if hasattr(self._window, "is_maximized"):
                        checker = getattr(self._window, "is_maximized")
                        if callable(checker):
                            is_maximized = checker()
                        elif isinstance(checker, bool):
                            is_maximized = checker
                    if is_maximized and hasattr(self._window, "restore"):
                        self._window.restore()
                        return {"success": True}
                    if hasattr(self._window, "maximize"):
                        self._window.maximize()
                        return {"success": True}
                    if hasattr(self._window, "toggle_fullscreen"):
                        self._window.toggle_fullscreen()
                        return {"success": True}
                except Exception as exc:  # pragma: no cover - defensive
                    return {"success": False, "error": str(exc)}
                return {"success": False, "error": "unsupported"}

            def window_zoom(self):
                if not self._window:
                    return {"success": False, "error": "window_not_ready"}
                try:
                    if sys.platform == "darwin":
                        ns_window = None
                        for attr in ("_window", "window", "ns_window", "_ns_window"):
                            candidate = getattr(self._window, attr, None)
                            if candidate is not None and hasattr(candidate, "zoom_"):
                                ns_window = candidate
                                break
                        if ns_window is not None:
                            ns_window.zoom_(None)
                            return {"success": True}
                except Exception as exc:  # pragma: no cover - defensive
                    return {"success": False, "error": str(exc)}
                return self.window_toggle_maximize()

            def window_toggle_fullscreen(self):
                if not self._window:
                    return {"success": False, "error": "window_not_ready"}
                try:
                    if hasattr(self._window, "toggle_fullscreen"):
                        self._window.toggle_fullscreen()
                        return {"success": True}
                except Exception as exc:  # pragma: no cover - defensive
                    return {"success": False, "error": str(exc)}
                return {"success": False, "error": "unsupported"}

            def window_restore(self):
                if not self._window:
                    return {"success": False, "error": "window_not_ready"}
                try:
                    if hasattr(self._window, "restore"):
                        self._window.restore()
                        return {"success": True}
                except Exception as exc:  # pragma: no cover - defensive
                    return {"success": False, "error": str(exc)}
                return {"success": False, "error": "unsupported"}

            def window_get_size(self):
                if not self._window:
                    return {"success": False, "error": "window_not_ready"}
                try:
                    if hasattr(self._window, "get_size"):
                        width, height = self._window.get_size()
                        return {"success": True, "width": width, "height": height}
                    if hasattr(self._window, "width") and hasattr(self._window, "height"):
                        return {
                            "success": True,
                            "width": getattr(self._window, "width"),
                            "height": getattr(self._window, "height"),
                        }
                except Exception as exc:  # pragma: no cover - defensive
                    return {"success": False, "error": str(exc)}
                return {"success": False, "error": "unsupported"}

            def window_set_size(self, width: float, height: float):
                if not self._window:
                    return {"success": False, "error": "window_not_ready"}
                try:
                    if hasattr(self._window, "resize"):
                        self._window.resize(int(width), int(height))
                        return {"success": True}
                    if hasattr(self._window, "set_size"):
                        self._window.set_size(int(width), int(height))
                        return {"success": True}
                    if hasattr(self._window, "resize_to"):
                        self._window.resize_to(int(width), int(height))
                        return {"success": True}
                except Exception as exc:  # pragma: no cover - defensive
                    return {"success": False, "error": str(exc)}
                return {"success": False, "error": "unsupported"}

            def window_get_position(self):
                if not self._window:
                    return {"success": False, "error": "window_not_ready"}
                try:
                    if hasattr(self._window, "get_position"):
                        x, y = self._window.get_position()
                        return {"success": True, "x": x, "y": y}
                    if hasattr(self._window, "x") and hasattr(self._window, "y"):
                        return {"success": True, "x": self._window.x, "y": self._window.y}
                except Exception as exc:  # pragma: no cover - defensive
                    return {"success": False, "error": str(exc)}
                return {"success": False, "error": "unsupported"}

            def window_move(self, x: float, y: float):
                if not self._window:
                    return {"success": False, "error": "window_not_ready"}
                try:
                    if hasattr(self._window, "move"):
                        self._window.move(int(x), int(y))
                        return {"success": True}
                    if hasattr(self._window, "set_position"):
                        self._window.set_position(int(x), int(y))
                        return {"success": True}
                    if hasattr(self._window, "set_location"):
                        self._window.set_location(int(x), int(y))
                        return {"success": True}
                except Exception as exc:  # pragma: no cover - defensive
                    return {"success": False, "error": str(exc)}
                return {"success": False, "error": "unsupported"}


            def window_get_on_top(self):
                if not self._window:
                    return {"success": False, "error": "window_not_ready"}
                try:
                    if hasattr(self._window, "on_top"):
                        return {"success": True, "onTop": bool(getattr(self._window, "on_top"))}
                except Exception as exc:  # pragma: no cover - defensive
                    return {"success": False, "error": str(exc)}
                return {"success": False, "error": "unsupported"}

            def window_set_on_top(self, value: bool):
                if not self._window:
                    return {"success": False, "error": "window_not_ready"}
                try:
                    if hasattr(self._window, "on_top"):
                        # Run in thread to prevent blocking/hanging on Windows
                        def set_on_top_async():
                            try:
                                setattr(self._window, "on_top", bool(value))
                            except Exception as e:
                                logger.warning(f"Failed to set window on_top: {e}")

                        import threading
                        thread = threading.Thread(target=set_on_top_async, daemon=True)
                        thread.start()
                        return {"success": True, "onTop": bool(value)}
                except Exception as exc:  # pragma: no cover - defensive
                    return {"success": False, "error": str(exc)}
                return {"success": False, "error": "unsupported"}

            def window_start_drag(self):
                if not self._window:
                    return {"success": False, "error": "window_not_ready"}
                try:
                    if sys.platform != "darwin":
                        return {"success": False, "error": "unsupported"}
                    native_window = getattr(self._window, "native", None)
                    if not native_window or not hasattr(native_window, "performWindowDragWithEvent_"):
                        return {"success": False, "error": "unsupported"}
                    try:
                        from AppKit import NSApp
                    except Exception as exc:
                        return {"success": False, "error": str(exc)}
                    event = NSApp.currentEvent()
                    if not event:
                        return {"success": False, "error": "no_event"}
                    native_window.performWindowDragWithEvent_(event)
                    return {"success": True}
                except Exception as exc:  # pragma: no cover - defensive
                    return {"success": False, "error": str(exc)}

            def window_start_resize(self, edge: str):
                """
                Start window resize from a specific edge on Windows.
                Edge can be: 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'
                """
                if not self._window:
                    return {"success": False, "error": "window_not_ready"}
                try:
                    if sys.platform != "win32":
                        return {"success": False, "error": "unsupported"}

                    import ctypes
                    from ctypes import wintypes

                    # Get window handle
                    hwnd = None
                    native_window = getattr(self._window, "native", None)

                    if hasattr(self._window, "hwnd"):
                        hwnd = self._window.hwnd
                    elif native_window and hasattr(native_window, "winId"):
                        try:
                            hwnd = int(native_window.winId())
                        except:
                            pass

                    if not hwnd:
                        return {"success": False, "error": "no_hwnd"}

                    # Windows API constants for resize edges
                    HTLEFT = 10
                    HTRIGHT = 11
                    HTTOP = 12
                    HTTOPLEFT = 13
                    HTTOPRIGHT = 14
                    HTBOTTOM = 15
                    HTBOTTOMLEFT = 16
                    HTBOTTOMRIGHT = 17

                    # Map edge string to HT constant
                    edge_map = {
                        'left': HTLEFT,
                        'right': HTRIGHT,
                        'top': HTTOP,
                        'bottom': HTBOTTOM,
                        'top-left': HTTOPLEFT,
                        'top-right': HTTOPRIGHT,
                        'bottom-left': HTBOTTOMLEFT,
                        'bottom-right': HTBOTTOMRIGHT,
                    }

                    ht_value = edge_map.get(edge)
                    if not ht_value:
                        return {"success": False, "error": "invalid_edge"}

                    # Windows messages
                    WM_NCLBUTTONDOWN = 0x00A1

                    # Send message to start resize
                    user32 = ctypes.windll.user32
                    user32.ReleaseCapture()
                    user32.SendMessageW(hwnd, WM_NCLBUTTONDOWN, ht_value, 0)

                    return {"success": True}
                except Exception as exc:  # pragma: no cover - defensive
                    return {"success": False, "error": str(exc)}

            def window_enable_resize(self):
                """
                Enable resize borders for frameless window on Windows.
                Properly sets window styles and handles WM_NCHITTEST.
                """
                logger.info("window_enable_resize called")
                if not self._window:
                    logger.error("window_enable_resize: window not ready")
                    return {"success": False, "error": "window_not_ready"}
                try:
                    if sys.platform != "win32":
                        logger.info("window_enable_resize: not Windows, skipping")
                        return {"success": False, "error": "unsupported"}

                    import ctypes
                    from ctypes import wintypes, WINFUNCTYPE, c_int, byref, c_long, c_void_p

                    # Get window handle
                    hwnd = None
                    native_window = getattr(self._window, "native", None)
                    logger.info(f"Attempting to get HWND - native_window: {native_window}")
                    logger.info(f"Native window type: {type(native_window)}")

                    # Try different methods to get HWND depending on the backend
                    if hasattr(self._window, "hwnd"):
                        hwnd = self._window.hwnd
                        logger.info(f"Got HWND from window.hwnd: {hwnd}")
                    elif native_window:
                        # For Windows Forms (edgechromium backend) - Handle is an IntPtr
                        if hasattr(native_window, "Handle") or hasattr(native_window, "get_Handle"):
                            try:
                                # Get the Handle property/method
                                if hasattr(native_window, "get_Handle"):
                                    handle_obj = native_window.get_Handle()
                                else:
                                    handle_obj = native_window.Handle

                                logger.info(f"Handle object: {handle_obj}, type: {type(handle_obj)}")

                                # Try different ways to convert .NET IntPtr to Python int
                                # Method 1: Try ToInt64/ToInt32 methods (standard .NET IntPtr methods)
                                if hasattr(handle_obj, "ToInt64"):
                                    hwnd = int(handle_obj.ToInt64())
                                    logger.info(f"Got HWND from Handle.ToInt64(): {hwnd}")
                                elif hasattr(handle_obj, "ToInt32"):
                                    hwnd = int(handle_obj.ToInt32())
                                    logger.info(f"Got HWND from Handle.ToInt32(): {hwnd}")
                                # Method 2: Try __int__ magic method
                                elif hasattr(handle_obj, "__int__"):
                                    hwnd = int(handle_obj.__int__())
                                    logger.info(f"Got HWND from Handle.__int__(): {hwnd}")
                                # Method 3: Access the internal value field
                                elif hasattr(handle_obj, "value"):
                                    hwnd = int(handle_obj.value)
                                    logger.info(f"Got HWND from Handle.value: {hwnd}")
                                # Method 4: String representation as fallback (handle is in the repr)
                                else:
                                    # Extract from string like "<IntPtr 3738446>"
                                    handle_str = str(handle_obj)
                                    logger.info(f"Handle string repr: {handle_str}")
                                    import re
                                    match = re.search(r'(\d+)', handle_str)
                                    if match:
                                        hwnd = int(match.group(1))
                                        logger.info(f"Got HWND from string parsing: {hwnd}")
                            except Exception as e:
                                logger.error(f"Failed to get HWND from Handle: {e}", exc_info=True)
                        # For Qt backend
                        elif hasattr(native_window, "winId"):
                            try:
                                hwnd = int(native_window.winId())
                                logger.info(f"Got HWND from native.winId(): {hwnd}")
                            except Exception as e:
                                logger.error(f"Failed to get HWND from winId: {e}")
                        # For effectiveWinId (some Qt versions)
                        elif hasattr(native_window, "effectiveWinId"):
                            try:
                                hwnd = int(native_window.effectiveWinId())
                                logger.info(f"Got HWND from native.effectiveWinId(): {hwnd}")
                            except Exception as e:
                                logger.error(f"Failed to get HWND from effectiveWinId: {e}")

                    if not hwnd:
                        logger.error("Could not get HWND - window handle is None")
                        if native_window:
                            logger.error(f"Native window attributes: {[attr for attr in dir(native_window) if not attr.startswith('_')]}")
                        return {"success": False, "error": "no_hwnd"}

                    logger.info(f"SUCCESS! Got HWND: {hwnd} - Now setting up resize...")

                    user32 = ctypes.windll.user32

                    # Step 1: Set proper window styles
                    GWL_STYLE = -16
                    GWL_EXSTYLE = -20

                    # Window styles
                    WS_CAPTION = 0x00C00000
                    WS_THICKFRAME = 0x00040000
                    WS_MINIMIZEBOX = 0x00020000
                    WS_MAXIMIZEBOX = 0x00010000
                    WS_SYSMENU = 0x00080000

                    # Get current style
                    current_style = user32.GetWindowLongW(hwnd, GWL_STYLE)
                    current_ex_style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
                    logger.info(f"Current style: {hex(current_style)}, ex_style: {hex(current_ex_style)}")

                    # Add WS_THICKFRAME and remove WS_CAPTION for resizable frameless window
                    new_style = current_style | WS_THICKFRAME | WS_MAXIMIZEBOX | WS_MINIMIZEBOX | WS_SYSMENU
                    new_style = new_style & ~WS_CAPTION  # Remove caption to stay frameless

                    # Extended styles for better rendering
                    WS_EX_COMPOSITED = 0x02000000  # Enable double buffering for smooth resize
                    new_ex_style = current_ex_style | WS_EX_COMPOSITED

                    user32.SetWindowLongW(hwnd, GWL_STYLE, new_style)
                    user32.SetWindowLongW(hwnd, GWL_EXSTYLE, new_ex_style)
                    logger.info(f"New style: {hex(new_style)}, new ex_style: {hex(new_ex_style)}")

                    # Apply the style change
                    SWP_FRAMECHANGED = 0x0020
                    SWP_NOMOVE = 0x0002
                    SWP_NOSIZE = 0x0001
                    SWP_NOZORDER = 0x0004
                    SWP_NOACTIVATE = 0x0010

                    user32.SetWindowPos(
                        hwnd, 0, 0, 0, 0, 0,
                        SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE
                    )

                    # Step 2: Enable DWM composition for smooth rendering
                    try:
                        dwmapi = ctypes.windll.dwmapi

                        # Extend frame into client area to fully remove title bar
                        class MARGINS(ctypes.Structure):
                            _fields_ = [
                                ("cxLeftWidth", c_int),
                                ("cxRightWidth", c_int),
                                ("cyTopHeight", c_int),
                                ("cyBottomHeight", c_int),
                            ]

                        # Extend frame by 1 pixel to enable glass effect and remove title bar
                        margins = MARGINS(0, 0, 1, 0)
                        dwmapi.DwmExtendFrameIntoClientArea(hwnd, byref(margins))
                        logger.info("DWM frame extended into client area - title bar removed")

                        # DWM_BLURBEHIND structure for smooth composition
                        DWM_BB_ENABLE = 0x00000001
                        DWM_BB_BLURREGION = 0x00000002

                        class DWM_BLURBEHIND(ctypes.Structure):
                            _fields_ = [
                                ("dwFlags", wintypes.DWORD),
                                ("fEnable", wintypes.BOOL),
                                ("hRgnBlur", wintypes.HANDLE),
                                ("fTransitionOnMaximized", wintypes.BOOL),
                            ]

                        # Enable blur behind for smooth rendering
                        bb = DWM_BLURBEHIND()
                        bb.dwFlags = DWM_BB_ENABLE
                        bb.fEnable = True
                        bb.hRgnBlur = None
                        bb.fTransitionOnMaximized = False

                        dwmapi.DwmEnableBlurBehindWindow(hwnd, byref(bb))
                        logger.info("DWM blur behind enabled for smooth rendering")
                    except Exception as e:
                        logger.warning(f"Could not enable DWM composition: {e}")

                    # Step 3: Subclass window to handle messages
                    GWLP_WNDPROC = -4
                    WM_NCHITTEST = 0x0084
                    WM_NCCALCSIZE = 0x0083
                    WM_ERASEBKGND = 0x0014  # Prevent white background flash
                    WM_ENTERSIZEMOVE = 0x0231
                    WM_EXITSIZEMOVE = 0x0232
                    WM_WINDOWPOSCHANGING = 0x0046

                    # Hit test return values
                    HTCLIENT = 1
                    HTCAPTION = 2
                    HTLEFT = 10
                    HTRIGHT = 11
                    HTTOP = 12
                    HTTOPLEFT = 13
                    HTTOPRIGHT = 14
                    HTBOTTOM = 15
                    HTBOTTOMLEFT = 16
                    HTBOTTOMRIGHT = 17

                    BORDER_WIDTH = 8
                    TITLEBAR_HEIGHT = 40  # Height of custom titlebar for dragging

                    # Window procedure type
                    WNDPROC = WINFUNCTYPE(c_long, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)

                    # Store original wndproc as instance variable to prevent GC
                    original_wndproc = [None]  # Use list to allow mutation in closure
                    is_resizing = [False]  # Track resize state

                    def custom_wnd_proc(hwnd_local, msg, wparam, lparam):
                        if msg == WM_NCCALCSIZE:
                            # Always return 0 to completely remove the default frame/titlebar
                            # This prevents any native window chrome from appearing
                            return 0

                        elif msg == WM_ENTERSIZEMOVE:
                            # User started resizing/moving
                            is_resizing[0] = True
                            return user32.CallWindowProcW(original_wndproc[0], hwnd_local, msg, wparam, lparam)

                        elif msg == WM_EXITSIZEMOVE:
                            # User finished resizing/moving
                            is_resizing[0] = False
                            return user32.CallWindowProcW(original_wndproc[0], hwnd_local, msg, wparam, lparam)

                        elif msg == WM_ERASEBKGND:
                            # Return 1 to prevent white background flash during resize
                            return 1

                        elif msg == WM_NCHITTEST:
                            # Default behavior first
                            result = user32.CallWindowProcW(original_wndproc[0], hwnd_local, msg, wparam, lparam)

                            # Get cursor position (screen coordinates)
                            x = ctypes.c_short(lparam & 0xFFFF).value
                            y = ctypes.c_short((lparam >> 16) & 0xFFFF).value

                            # Get window rectangle
                            rect = wintypes.RECT()
                            user32.GetWindowRect(hwnd_local, byref(rect))

                            # Convert to window-relative coordinates
                            rel_x = x - rect.left
                            rel_y = y - rect.top
                            window_width = rect.right - rect.left
                            window_height = rect.bottom - rect.top

                            # Check edges and corners
                            on_left_edge = rel_x < BORDER_WIDTH
                            on_right_edge = rel_x >= window_width - BORDER_WIDTH
                            on_top_edge = rel_y < BORDER_WIDTH
                            on_bottom_edge = rel_y >= window_height - BORDER_WIDTH

                            # Return appropriate hit-test value
                            if on_top_edge and on_left_edge:
                                return HTTOPLEFT
                            if on_top_edge and on_right_edge:
                                return HTTOPRIGHT
                            if on_bottom_edge and on_left_edge:
                                return HTBOTTOMLEFT
                            if on_bottom_edge and on_right_edge:
                                return HTBOTTOMRIGHT
                            if on_left_edge:
                                return HTLEFT
                            if on_right_edge:
                                return HTRIGHT
                            if on_top_edge:
                                return HTTOP
                            if on_bottom_edge:
                                return HTBOTTOM

                            # If in titlebar area (custom header), allow dragging
                            # But avoid the buttons and other controls
                            if rel_y < TITLEBAR_HEIGHT and result == HTCLIENT:
                                return HTCAPTION

                            return result

                        # Call original window procedure for all other messages
                        return user32.CallWindowProcW(original_wndproc[0], hwnd_local, msg, wparam, lparam)

                    # Create the callback
                    new_wnd_proc_func = WNDPROC(custom_wnd_proc)

                    # Subclass the window
                    old_wndproc = user32.SetWindowLongPtrW(hwnd, GWLP_WNDPROC, ctypes.cast(new_wnd_proc_func, c_void_p).value)

                    if not old_wndproc:
                        logger.error("Failed to subclass window - SetWindowLongPtrW returned 0")
                        return {"success": False, "error": "subclass_failed"}

                    original_wndproc[0] = old_wndproc

                    # Store references to prevent garbage collection
                    self._window_resize_callback = new_wnd_proc_func
                    self._original_wndproc = old_wndproc

                    logger.info("Window subclassed successfully - resize enabled")
                    return {"success": True}

                except Exception as exc:
                    logger.error(f"Failed to enable window resize: {exc}", exc_info=True)
                    return {"success": False, "error": str(exc)}


            def open_external(self, url: str):
                if not url:
                    return {"success": False, "error": "invalid_url"}
                try:
                    import webbrowser

                    webbrowser.open(url)
                    return {"success": True}
                except Exception as exc:  # pragma: no cover - defensive
                    return {"success": False, "error": str(exc)}

        bridge = EmbeddedBridge(webview)

        # Set app name BEFORE creating the window
        if sys.platform == "darwin":
            try:
                from AppKit import NSApp, NSProcessInfo, NSApplicationActivationPolicyRegular
                from Foundation import NSBundle, NSMutableDictionary

                # Set process name
                processInfo = NSProcessInfo.processInfo()
                processInfo.setProcessName_("X-Caption")

                # Override bundle info
                bundle = NSBundle.mainBundle()
                if bundle:
                    info = bundle.localizedInfoDictionary() or bundle.infoDictionary()
                    if info:
                        info = NSMutableDictionary.dictionaryWithDictionary_(info)
                        info["CFBundleName"] = "X-Caption"
                        info["CFBundleDisplayName"] = "X-Caption"

                # Set activation policy and activate
                NSApp.setActivationPolicy_(NSApplicationActivationPolicyRegular)
                NSApp.activateIgnoringOtherApps_(True)

                logger.info("Set app name to X-Caption")
            except Exception as e:
                logger.warning(f"Could not set app name: {e}")

        try:
            webview.settings["DRAG_REGION_SELECTOR"] = ".pywebview-drag-region"
            if "DRAG_REGION_DIRECT_TARGET_ONLY" in webview.settings:
                webview.settings["DRAG_REGION_DIRECT_TARGET_ONLY"] = False
            if "ALLOW_FULLSCREEN" in webview.settings:
                webview.settings["ALLOW_FULLSCREEN"] = True
            # Disable default menu if the setting exists
            if "OPEN_DEVTOOLS_IN_DEBUG" in webview.settings:
                webview.settings["OPEN_DEVTOOLS_IN_DEBUG"] = False
        except Exception:
            pass

        window_kwargs = {
            "title": "X-Caption",
            "html": placeholder_html,
            "width": width,
            "height": height,
            "min_size": (360, 640),
            "resizable": True,
            "easy_drag": False,
            "frameless": sys.platform == "darwin",  # Only frameless on macOS
            "js_api": bridge,
        }

        window = webview.create_window(**window_kwargs)
        if sys.platform == "darwin":
            try:
                from AppKit import (
                    NSWindowStyleMaskBorderless,
                    NSWindowStyleMaskClosable,
                    NSWindowStyleMaskMiniaturizable,
                    NSWindowStyleMaskResizable,
                )
                try:
                    from AppKit import NSWindowTitleHidden
                except Exception:
                    NSWindowTitleHidden = 1
            except Exception:
                pass
            else:
                try:
                    native_window = getattr(window, "native", None)
                    if native_window and hasattr(native_window, "setStyleMask_"):
                        mask = (
                            NSWindowStyleMaskBorderless
                            | NSWindowStyleMaskResizable
                            | NSWindowStyleMaskMiniaturizable
                            | NSWindowStyleMaskClosable
                        )
                        native_window.setStyleMask_(mask)
                        if hasattr(native_window, "setTitleVisibility_"):
                            native_window.setTitleVisibility_(NSWindowTitleHidden)
                        if hasattr(native_window, "setTitlebarAppearsTransparent_"):
                            native_window.setTitlebarAppearsTransparent_(True)
                    if native_window and hasattr(native_window, "setMovableByWindowBackground_"):
                        native_window.setMovableByWindowBackground_(False)
                except Exception:
                    pass

        bridge.attach(window)

        if icon_path.exists() and hasattr(window, "icon"):
            try:
                window.icon = str(icon_path)
            except Exception:
                pass

        def poll_and_load():
            # Server should already be ready, but do a quick check
            if dev_url:
                # For dev mode, still need to wait for Vite
                if not wait_for_url(dev_url):
                    print("[WEB] Dev server not ready, loading anyway...")
            print("[WEB] Loading interface...")
            window.load_url(url)

        threading.Thread(target=poll_and_load, daemon=True).start()

        backend_candidates: list[str | None] = []
        if IS_WINDOWS:
            backend_candidates.extend(["edgechromium", "mshtml"])
        elif sys.platform == "darwin":
            backend_candidates.append("cocoa")
        elif sys.platform.startswith("linux"):
            backend_candidates.extend(["edgechromium", "cef", "qt", "gtk"])

        if sys.platform != "darwin":
            backend_candidates.append(None)  # auto-detect fallback

        def on_webview_ready():
            try:
                if sys.platform == "darwin":
                    # Delay menu setup to ensure it overrides pywebview's default menu
                    # Use performSelectorOnMainThread to ensure it runs on the main thread
                    def delayed_menu_setup():
                        logger.info("Waiting for webview to fully initialize before setting menu...")
                        time.sleep(1.0)  # Wait for webview to finish initialization
                        logger.info("Setting up custom macOS menu now...")

                        # Run on main thread using AppKit
                        try:
                            from AppKit import NSApp
                            from PyObjCTools import AppHelper

                            # Schedule menu setup on main thread
                            AppHelper.callAfter(setup_macos_menu)
                            logger.info("Custom menu setup scheduled on main thread")
                        except Exception as e:
                            logger.error(f"Failed to schedule menu setup: {e}")
                            # Fallback: try direct call
                            setup_macos_menu()

                    threading.Thread(target=delayed_menu_setup, daemon=True).start()

                    try:
                        native_window = getattr(window, "native", None)
                        if native_window:
                            native_window.setMovableByWindowBackground_(False)
                    except Exception:
                        pass

            except Exception:
                logger.debug("Window initialization completed", exc_info=True)

        start_kwargs = {"debug": False, "func": on_webview_ready}

        for backend in backend_candidates:
            try:
                if backend:
                    logger.info("Attempting pywebview backend '%s'", backend)
                    webview.start(gui=backend, **start_kwargs)
                else:
                    logger.info("Attempting pywebview with auto-detected backend")
                    webview.start(**start_kwargs)
                return "native"
            except (ValueError, RuntimeError) as backend_error:
                if backend is None:
                    raise
                if backend == "cef":
                    logger.warning(
                        "CEF backend unavailable (%s). Install 'cefpython3' and ensure it supports your Python version to use embedded Chromium.",
                        backend_error,
                    )
                logger.warning(
                    "pywebview backend '%s' unavailable (%s). Trying next option...",
                    backend,
                    backend_error,
                )
        raise RuntimeError("No pywebview backend succeeded")

    except ImportError as exc:
        logger.warning("pywebview not available: %s", exc)

    except Exception as exc:
        logger.error("Failed to open embedded window: %s", exc, exc_info=True)
    webbrowser.open(url, new=2)
    print(f"[INFO] Browser opened at {url}")
    return "fallback"


def wait_for_server(port: int = 11440, timeout: float = 10.0) -> bool:
    """Wait for the HTTP server health endpoint to become available."""
    health_url = f"http://127.0.0.1:{port}/health"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    profile_start = time.perf_counter()
    start = time.time()
    printed = False

    while time.time() - start < timeout:
        try:
            request = urllib.request.Request(health_url)
            with opener.open(request, timeout=2) as response:
                if response.status == 200:
                    if printed:
                        print("[WEB] Server is ready.")
                    if _startup_profile_enabled():
                        elapsed = time.perf_counter() - profile_start
                        print(f"[STARTUP] Health check ready in {elapsed:.3f}s")
                    return True
        except urllib.error.URLError:
            pass
        except Exception as exc:
            logger.debug("Health check attempt failed: %s", exc)
        if not printed and time.time() - start > 1.5:
            print("[WEB] Still starting up... heavy libraries are loading, please wait.")
            printed = True
        time.sleep(0.2)

    print("[WEB] Server is taking longer than expected but will continue starting in the background.")
    print(f"      You can periodically refresh {health_url} to check availability.")
    if _startup_profile_enabled():
        elapsed = time.perf_counter() - profile_start
        print(f"[STARTUP] Health check timed out after {elapsed:.3f}s (timeout {timeout:.1f}s)")
    return False


def wait_for_url(url: str, timeout: float = 30.0) -> bool:
    """Wait for an arbitrary HTTP URL to respond with 2xx/3xx."""
    target = (url or "").strip()
    if not target:
        return False

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    start = time.time()
    printed = False

    while time.time() - start < timeout:
        try:
            request = urllib.request.Request(target)
            with opener.open(request, timeout=2) as response:
                if 200 <= response.status < 400:
                    if printed:
                        print(f"[UI] Dev server is ready: {target}")
                    return True
        except urllib.error.URLError:
            pass
        except Exception as exc:
            logger.debug("Dev UI check attempt failed: %s", exc)
        if not printed and time.time() - start > 1.5:
            print(f"[UI] Waiting for dev UI server... ({target})")
            printed = True
        time.sleep(0.5)

    print("[UI] Dev UI server is taking longer than expected.")
    print(f"     You can open it manually: {target}")
    return False


def show_running_info(port: int = 11440):
    """Show information about the running application."""
    dev_url = os.environ.get("XCAPTION_UI_DEV_URL")
    lines = [
        "=" * 70,
        "[OK]  X-Caption is now running!",
        "=" * 70,
        "",
        f"Web Interface:  {dev_url}" if dev_url else f"Web Interface:  http://localhost:{port}",
        f"Backend API:    http://localhost:{port}" if dev_url else f"Health Check:   http://localhost:{port}/health",
        "",
        "Features:",
        "   - Upload audio/video files for transcription",
        "   - Support for multiple languages (Chinese, English, Japanese, Korean)",
        "   - Whisper.cpp offline transcription",
        "   - On-demand model download with progress",
        "   - Real-time progress updates",
        "   - Download transcription results",
        "",
        "Supported formats:",
        "   MP3, WAV, M4A, FLAC, OGG, MP4, AVI, MOV",
        "",
        "WebSocket Mode: HTTP polling (no external dependencies)",
        "",
        "Press Ctrl+C in this window to stop the application.",
        "",
    ]
    for line in lines:
        print(line)


def main():
    """Main application entry point."""
    try:
        _ensure_single_instance()
    except RuntimeError as instance_error:
        logger.warning(str(instance_error))
        if IS_WINDOWS:
            try:
                ctypes.windll.user32.MessageBoxW(None, str(instance_error), "X-Caption", 0x00000040)
            except Exception:
                pass
        else:
            print(str(instance_error))
        return

    try:
        print_banner()
        check_and_setup_environment()

        start_worker_threads()

        port = int(os.environ.get("PORT", 11440))
        start_web_server(port)
        show_running_info(port)

        launch_mode = open_browser(port)

        if launch_mode == "native":
            print()
            print("=" * 70)
            print("X-Caption window closed.")
            print("=" * 70)
            print("Thank you for using X-Caption!")
            print()
            _force_exit(0)

        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print()
            print("=" * 70)
            print("Shutting down...")
            print("=" * 70)
            print()
            print("Thank you for using X-Caption!")
            print()

    except Exception as exc:
        import traceback

        logger.error("Application error: %s", exc, exc_info=True)
        print()
        print("=" * 70)
        print("Application Error - X-Caption has crashed")
        print("=" * 70)
        print(f"Error: {exc}")
        print(f"Error Type: {type(exc).__name__}")
        print()
        print(traceback.format_exc())
        print()

        # Provide helpful suggestions based on common errors
        error_str = str(exc).upper()
        if "CUDA" in error_str or "GPU" in error_str:
            print("Hint: This appears to be a CUDA/GPU error.")
            print("   Try setting device='cpu' in transcription settings.")
        elif "MODEL" in error_str or "WHISPER" in error_str:
            print("Hint: Model asset issue detected.")
            print("   Use the in-app downloader from the AI Generate Caption button.")
        elif "MEMORY" in error_str:
            print("Hint: Memory error detected.")
            print("   Try with a smaller audio file or restart your computer.")
        elif "DLL" in error_str:
            print("Hint: DLL loading error detected.")
            print("   This may be due to missing system dependencies.")
        else:
            print("Hint: For troubleshooting:")
            print("   1. Check crash_report.json for detailed stack traces")
            print("   2. Confirm the model package exists in data/")
            print("   3. Run 'python xcaption_launcher.py --help' for diagnostics")

        print()
        if IS_WINDOWS:
            try:
                input("Press Enter to exit...")
            except Exception:
                pass

        sys.exit(1)


if __name__ == "__main__":
    main()
