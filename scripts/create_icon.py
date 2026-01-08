#!/usr/bin/env python3
"""
Convert PNG logo to macOS .icns file with all required sizes.

Generates icon in multiple resolutions:
- 16x16, 32x32, 64x64, 128x128, 256x256, 512x512, 1024x1024
- Both standard and @2x (retina) versions

Requires: PIL/Pillow
"""

import sys
import subprocess
import tempfile
from pathlib import Path


def check_dependencies():
    """Check if sips command is available (macOS only)."""
    if sys.platform != "darwin":
        print("Error: This script only works on macOS")
        return False

    try:
        subprocess.run(["sips", "--version"], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("Error: sips command not found (required on macOS)")
        return False


def create_icns(input_png: Path, output_icns: Path):
    """
    Create .icns file from PNG using macOS iconutil.

    Args:
        input_png: Path to source PNG file (should be at least 1024x1024)
        output_icns: Path to output .icns file
    """
    print(f"Creating .icns from: {input_png}")
    print(f"Output: {output_icns}")

    # Create temporary iconset directory
    with tempfile.TemporaryDirectory() as tmpdir:
        iconset_dir = Path(tmpdir) / "icon.iconset"
        iconset_dir.mkdir()

        # Required icon sizes (standard and @2x retina)
        sizes = [
            (16, "icon_16x16.png"),
            (32, "icon_16x16@2x.png"),
            (32, "icon_32x32.png"),
            (64, "icon_32x32@2x.png"),
            (128, "icon_128x128.png"),
            (256, "icon_128x128@2x.png"),
            (256, "icon_256x256.png"),
            (512, "icon_256x256@2x.png"),
            (512, "icon_512x512.png"),
            (1024, "icon_512x512@2x.png"),
        ]

        # Generate all sizes using sips
        for size, filename in sizes:
            output_path = iconset_dir / filename
            print(f"  Generating {filename} ({size}x{size})...")

            result = subprocess.run(
                [
                    "sips",
                    "-z", str(size), str(size),  # resize
                    str(input_png),
                    "--out", str(output_path)
                ],
                capture_output=True,
                text=True
            )

            if result.returncode != 0:
                print(f"Error creating {filename}: {result.stderr}")
                return False

        # Convert iconset to icns using iconutil
        print(f"\nConverting iconset to .icns...")
        result = subprocess.run(
            ["iconutil", "-c", "icns", str(iconset_dir), "-o", str(output_icns)],
            capture_output=True,
            text=True
        )

        if result.returncode != 0:
            print(f"Error: {result.stderr}")
            return False

    print(f"\n✅ Success! Created {output_icns}")
    print(f"   Size: {output_icns.stat().st_size / 1024:.1f} KB")
    return True


def main():
    """Main entry point."""
    if not check_dependencies():
        return 1

    # Get project root
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent

    # Input: assets/logo.png
    input_png = project_root / "assets" / "logo.png"
    if not input_png.exists():
        # Try static/logo.png as fallback
        input_png = project_root / "static" / "logo.png"
        if not input_png.exists():
            print(f"Error: logo.png not found in assets/ or static/")
            return 1

    # Output: assets/icon.icns
    output_icns = project_root / "assets" / "icon.icns"

    # Create the icon
    if create_icns(input_png, output_icns):
        print("\nYou can now rebuild the app to use the new icon:")
        print("  python scripts/build_macos.py --no-sign")
        return 0
    else:
        return 1


if __name__ == "__main__":
    sys.exit(main())
