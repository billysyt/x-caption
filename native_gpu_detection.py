#!/usr/bin/env python3
"""
GPU Detection and Configuration for X-Caption
Detects NVIDIA (CUDA) and AMD (Vulkan) GPUs on Windows, and Apple Metal on macOS.
"""
import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional, Dict, Any, Iterable

logger = logging.getLogger(__name__)

_GPU_DETECTION_CACHE: Optional[Dict[str, Any]] = None


def _candidate_engine_dirs() -> list[Path]:
    """Return existing engine directories to check for backend libraries."""
    candidates: list[Path] = []

    # Explicit engine path
    env_path = os.environ.get("XCAPTION_WHISPER_ENGINE")
    if env_path:
        try:
            env_candidate = Path(env_path)
            if env_candidate.exists():
                candidates.append(env_candidate if env_candidate.is_dir() else env_candidate.parent)
        except Exception:
            pass

    # Bundle locations (prod/dev)
    try:
        from native_config import get_bundle_dir  # local import to avoid heavy deps at startup
        bundle_dir = get_bundle_dir()
        candidates.append(bundle_dir / "whisper" / "engine")
        candidates.append(bundle_dir / "Resources" / "whisper" / "engine")
    except Exception:
        pass

    # Dev fallback (repo root)
    try:
        here = Path(__file__).resolve().parent
        candidates.append(here / "whisper" / "engine")
    except Exception:
        pass

    # De-duplicate and keep existing dirs only
    seen: set[Path] = set()
    existing: list[Path] = []
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        if candidate.exists() and candidate.is_dir():
            existing.append(candidate)
    return existing


def _backend_library_present(backend: str) -> bool:
    """Check if the required backend library is present in any engine dir."""
    backend = backend.lower()
    backend_files: dict[str, Iterable[str]] = {
        "cuda": ("ggml-cuda-whisper.dll", "ggml-cuda.dll"),
        "vulkan": ("ggml-vulkan-whisper.dll", "ggml-vulkan.dll"),
        "metal": ("libggml-metal.dylib", "libggml-metal.0.dylib"),
    }
    names = backend_files.get(backend)
    if not names:
        return False

    for engine_dir in _candidate_engine_dirs():
        for name in names:
            if (engine_dir / name).exists():
                return True
    return False


def _detect_nvidia_gpu() -> Optional[Dict[str, Any]]:
    """Detect NVIDIA GPU using nvidia-smi."""
    try:
        # Try to run nvidia-smi
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=5,
        )

        if result.returncode == 0 and result.stdout.strip():
            lines = result.stdout.strip().split('\n')
            if lines:
                parts = [p.strip() for p in lines[0].split(',')]
                if len(parts) >= 3:
                    backend_ready = _backend_library_present("cuda")
                    return {
                        "vendor": "NVIDIA",
                        "name": parts[0],
                        "driver_version": parts[1],
                        "memory": parts[2],
                        "backend": "cuda",
                        "available": backend_ready,
                    }
    except (FileNotFoundError, subprocess.TimeoutExpired, Exception) as e:
        logger.debug("NVIDIA GPU detection failed: %s", e)

    return None


def _detect_amd_gpu() -> Optional[Dict[str, Any]]:
    """Detect AMD GPU using Windows Management Instrumentation."""
    if sys.platform != "win32":
        return None

    try:
        # Use WMIC to query video controllers
        result = subprocess.run(
            ["wmic", "path", "win32_VideoController", "get", "name,DriverVersion", "/format:csv"],
            capture_output=True,
            text=True,
            timeout=5,
        )

        if result.returncode == 0 and result.stdout.strip():
            lines = result.stdout.strip().split('\n')
            for line in lines[1:]:  # Skip header
                if not line.strip():
                    continue
                parts = [p.strip() for p in line.split(',')]
                if len(parts) >= 3:
                    name = parts[2] if len(parts) > 2 else parts[1]
                    driver_version = parts[1] if len(parts) > 2 else "Unknown"

                    # Check if it's AMD/ATI
                    if any(keyword in name.upper() for keyword in ["AMD", "ATI", "RADEON"]):
                        backend_ready = _backend_library_present("vulkan")
                        return {
                            "vendor": "AMD",
                            "name": name,
                            "driver_version": driver_version,
                            "backend": "vulkan",  # Whisper.cpp uses Vulkan for AMD
                            "available": backend_ready,
                        }
    except (FileNotFoundError, subprocess.TimeoutExpired, Exception) as e:
        logger.debug("AMD GPU detection failed: %s", e)

    return None


def _detect_metal_gpu() -> Optional[Dict[str, Any]]:
    """Detect Apple Metal backend on macOS."""
    if sys.platform != "darwin":
        return None

    backend_ready = _backend_library_present("metal")
    return {
        "vendor": "Apple",
        "name": "Apple GPU",
        "backend": "metal",
        "available": backend_ready,
    }


def detect_gpu() -> Dict[str, Any]:
    """
    Detect available GPU and return configuration.

    Returns:
        Dict with GPU information:
        - vendor: "NVIDIA", "AMD", or None
        - name: GPU name
        - backend: "cuda", "vulkan", or "cpu"
        - available: True/False
        - device_label: Human-readable device label
    """
    global _GPU_DETECTION_CACHE

    # Return cached result if available
    if _GPU_DETECTION_CACHE is not None:
        return _GPU_DETECTION_CACHE

    # Check for forced CPU mode via environment variable
    force_cpu = os.environ.get("XCAPTION_FORCE_CPU", "").strip().lower() in {"1", "true", "yes"}
    if force_cpu:
        result = {
            "vendor": None,
            "name": "CPU (forced)",
            "backend": "cpu",
            "available": False,
            "device_label": "CPU (forced via XCAPTION_FORCE_CPU)",
        }
        _GPU_DETECTION_CACHE = result
        return result

    if sys.platform == "darwin":
        metal_gpu = _detect_metal_gpu()
        if metal_gpu:
            if metal_gpu.get("available"):
                metal_gpu["device_label"] = "Apple GPU (Metal)"
            else:
                metal_gpu["device_label"] = "Apple GPU (Metal backend missing)"
            _GPU_DETECTION_CACHE = metal_gpu
            logger.info("Detected Apple Metal backend")
            return metal_gpu

    # Try NVIDIA first (more common for ML workloads)
    nvidia_gpu = _detect_nvidia_gpu()
    if nvidia_gpu:
        if nvidia_gpu.get("available"):
            nvidia_gpu["device_label"] = f"{nvidia_gpu['name']} (CUDA)"
        else:
            nvidia_gpu["device_label"] = f"{nvidia_gpu['name']} (CUDA backend missing)"
        _GPU_DETECTION_CACHE = nvidia_gpu
        logger.info("Detected NVIDIA GPU: %s", nvidia_gpu["name"])
        return nvidia_gpu

    # Try AMD
    amd_gpu = _detect_amd_gpu()
    if amd_gpu:
        if amd_gpu.get("available"):
            amd_gpu["device_label"] = f"{amd_gpu['name']} (Vulkan)"
        else:
            amd_gpu["device_label"] = f"{amd_gpu['name']} (Vulkan backend missing)"
        _GPU_DETECTION_CACHE = amd_gpu
        logger.info("Detected AMD GPU: %s", amd_gpu["name"])
        return amd_gpu

    # Fallback to CPU
    result = {
        "vendor": None,
        "name": "CPU",
        "backend": "cpu",
        "available": False,
        "device_label": "CPU (no GPU detected)",
    }
    _GPU_DETECTION_CACHE = result
    logger.info("No GPU detected, using CPU")
    return result


def get_gpu_device_label() -> str:
    """Get human-readable device label for UI display."""
    gpu_info = detect_gpu()
    return gpu_info.get("device_label", "CPU")


def get_gpu_backend() -> str:
    """Get the backend to use (cuda, vulkan, or cpu)."""
    gpu_info = detect_gpu()
    return gpu_info.get("backend", "cpu")


def is_gpu_available() -> bool:
    """Check if GPU acceleration is available."""
    gpu_info = detect_gpu()
    return gpu_info.get("available", False)


def get_whisper_gpu_flags(n_gpu_layers: int = 999) -> list[str]:
    """
    Get whisper.cpp command-line flags for GPU acceleration.

    Args:
        n_gpu_layers: Number of layers to offload to GPU (999 = all layers)

    Returns:
        List of command-line flags to append to whisper.cpp command
    """
    gpu_info = detect_gpu()
    backend = gpu_info.get("backend", "cpu")

    if backend == "cpu" or not gpu_info.get("available", False):
        return []

    # Parse n_gpu_layers from environment if set
    env_layers = os.environ.get("XCAPTION_GPU_LAYERS", "").strip()
    if env_layers:
        try:
            n_gpu_layers = int(env_layers)
        except ValueError:
            pass

    flags = []

    if backend == "cuda":
        # NVIDIA CUDA backend
        flags.extend(["-ngl", str(n_gpu_layers)])  # n_gpu_layers
        logger.info("Using CUDA GPU acceleration with %d layers", n_gpu_layers)

    elif backend == "vulkan":
        # AMD Vulkan backend
        flags.extend(["-ngl", str(n_gpu_layers)])  # Vulkan also uses -ngl flag
        logger.info("Using Vulkan GPU acceleration with %d layers", n_gpu_layers)
    elif backend == "metal":
        # Apple Metal backend
        flags.extend(["-ngl", str(n_gpu_layers)])
        logger.info("Using Metal GPU acceleration with %d layers", n_gpu_layers)

    return flags


def print_gpu_info():
    """Print GPU information to console (for diagnostics)."""
    gpu_info = detect_gpu()
    print("=" * 70)
    print("GPU Detection Results")
    print("=" * 70)
    print(f"Device: {gpu_info.get('device_label', 'Unknown')}")
    print(f"Backend: {gpu_info.get('backend', 'cpu')}")
    print(f"GPU Available: {gpu_info.get('available', False)}")

    if gpu_info.get("vendor"):
        print(f"Vendor: {gpu_info['vendor']}")
        print(f"Name: {gpu_info['name']}")
        if gpu_info.get("driver_version"):
            print(f"Driver Version: {gpu_info['driver_version']}")
        if gpu_info.get("memory"):
            print(f"Memory: {gpu_info['memory']}")

    print()
    print("Environment Variables:")
    print(f"  XCAPTION_FORCE_CPU: {os.environ.get('XCAPTION_FORCE_CPU', 'not set')}")
    print(f"  XCAPTION_GPU_LAYERS: {os.environ.get('XCAPTION_GPU_LAYERS', 'not set (default: 999)')}")
    print("=" * 70)
    print()


if __name__ == "__main__":
    # Command-line testing
    logging.basicConfig(level=logging.INFO)
    print_gpu_info()
