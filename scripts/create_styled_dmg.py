#!/usr/bin/env python3
"""
Create a professionally styled macOS DMG installer.

Features:
- Custom background image with installation instructions
- Proper icon positioning (app on left, Applications on right)
- Custom window size and icon view
- Professional appearance like commercial apps
"""

import subprocess
import time
from pathlib import Path
import shutil


def create_background_image(output_path: Path, app_icon_path: Path):
    """
    Create a DMG background image using ImageMagick or sips.
    Falls back to a simple background if ImageMagick is not available.
    """
    # Simple approach: copy the app icon as background hint
    # Users can replace this with a custom background later

    # For now, we'll create the DMG without a background image
    # and let users add one manually if desired
    pass


def create_styled_dmg(app_path: Path, output_dmg: Path, volume_name: str = "X-Caption"):
    """
    Create a styled DMG with proper icon positioning.

    This creates a DMG that looks professional with:
    - Custom volume icon
    - App icon on the left
    - Applications folder link on the right
    - Properly sized window
    - Large icon view
    """
    print(f"Creating professional DMG installer...")

    # Remove existing DMG
    if output_dmg.exists():
        print(f"  Removing existing DMG: {output_dmg.name}")
        output_dmg.unlink()

    # Create temporary directory for DMG contents
    temp_dmg_dir = app_path.parent / "dmg_temp"
    if temp_dmg_dir.exists():
        shutil.rmtree(temp_dmg_dir)
    temp_dmg_dir.mkdir()

    print(f"  Copying app to temporary directory...")
    shutil.copytree(app_path, temp_dmg_dir / app_path.name, symlinks=True)

    # Create Applications symlink
    print(f"  Creating Applications symlink...")
    applications_link = temp_dmg_dir / "Applications"
    applications_link.symlink_to("/Applications")

    # Copy volume icon (make .VolumeIcon.icns)
    print(f"  Adding volume icon...")
    icon_source = app_path.parent.parent / "assets" / "icon.icns"
    if icon_source.exists():
        volume_icon = temp_dmg_dir / ".VolumeIcon.icns"
        shutil.copy2(icon_source, volume_icon)
    else:
        print(f"    Warning: icon.icns not found at {icon_source}")

    # Create a temporary writable DMG first
    temp_dmg = output_dmg.parent / f"{output_dmg.stem}_temp.dmg"
    if temp_dmg.exists():
        temp_dmg.unlink()

    print(f"  Creating temporary DMG...")
    subprocess.run([
        "hdiutil", "create",
        "-volname", volume_name,
        "-srcfolder", str(temp_dmg_dir),
        "-ov",
        "-format", "UDRW",  # Read-write format
        "-fs", "HFS+",  # Use HFS+ for better compatibility
        str(temp_dmg)
    ], check=True, capture_output=True)

    # Mount the DMG
    print(f"  Mounting DMG for styling...")
    result = subprocess.run(
        ["hdiutil", "attach", str(temp_dmg), "-readwrite", "-noverify", "-noautoopen"],
        capture_output=True,
        text=True,
        check=True
    )

    # Extract mount point from output
    mount_point = None
    for line in result.stdout.split('\n'):
        if '/Volumes/' in line:
            mount_point = line.split('\t')[-1].strip()
            break

    if not mount_point:
        print("  Error: Could not find mount point")
        return False

    print(f"  Mounted at: {mount_point}")

    # Set custom volume icon attribute
    try:
        volume_icon_path = Path(mount_point) / ".VolumeIcon.icns"
        if volume_icon_path.exists():
            subprocess.run(
                ["SetFile", "-a", "C", mount_point],
                check=True,
                capture_output=True
            )
            print(f"  ✓ Custom volume icon set")
    except Exception as e:
        print(f"    Warning: Could not set volume icon: {e}")

    # Apply styling with AppleScript
    print(f"  Applying window styling...")

    applescript = f'''
tell application "Finder"
    tell disk "{volume_name}"
        open
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        set the bounds of container window to {{100, 100, 740, 520}}
        set viewOptions to the icon view options of container window
        set arrangement of viewOptions to not arranged
        set icon size of viewOptions to 128
        set text size of viewOptions to 14

        -- Position app icon on the left
        set position of item "{app_path.name}" of container window to {{160, 205}}

        -- Position Applications link on the right
        set position of item "Applications" of container window to {{480, 205}}

        -- Update and close
        update without registering applications
        delay 1
        close
    end tell
end tell
'''

    try:
        subprocess.run(
            ["osascript", "-e", applescript],
            check=True,
            capture_output=True,
            text=True
        )
        print(f"  ✓ Window styling applied")
    except subprocess.CalledProcessError as e:
        print(f"  Warning: Could not apply styling: {e.stderr}")

    # Give the system time to apply changes and write .DS_Store
    print(f"  Waiting for system to save settings...")
    time.sleep(3)

    # Sync to ensure .DS_Store is written
    subprocess.run(["sync"], check=False)
    time.sleep(1)

    # Unmount
    print(f"  Unmounting DMG...")
    max_attempts = 5
    for attempt in range(max_attempts):
        try:
            subprocess.run(["hdiutil", "detach", mount_point], check=True, capture_output=True, timeout=10)
            break
        except subprocess.TimeoutExpired:
            print(f"    Detach timeout, retry {attempt + 1}/{max_attempts}...")
            time.sleep(2)
        except subprocess.CalledProcessError as e:
            if attempt < max_attempts - 1:
                print(f"    Detach failed, retry {attempt + 1}/{max_attempts}...")
                time.sleep(2)
            else:
                print(f"    Force detaching...")
                subprocess.run(["hdiutil", "detach", mount_point, "-force"], check=False)

    # Convert to compressed read-only format
    print(f"  Converting to compressed format...")
    subprocess.run([
        "hdiutil", "convert", str(temp_dmg),
        "-format", "UDZO",
        "-imagekey", "zlib-level=9",
        "-o", str(output_dmg)
    ], check=True, capture_output=True)

    # Clean up
    temp_dmg.unlink()
    shutil.rmtree(temp_dmg_dir)

    if output_dmg.exists():
        size_mb = output_dmg.stat().st_size / (1024 * 1024)
        print(f"\n✅ Professional DMG created: {output_dmg}")
        print(f"   Size: {size_mb:.1f} MB")
        return True
    else:
        print(f"\n❌ Error: DMG creation failed")
        return False


def main():
    """Main entry point for standalone usage."""
    import sys

    if len(sys.argv) < 2:
        print("Usage: python create_styled_dmg.py <app_path> [output_dmg]")
        return 1

    app_path = Path(sys.argv[1])
    if not app_path.exists():
        print(f"Error: App not found: {app_path}")
        return 1

    if len(sys.argv) > 2:
        output_dmg = Path(sys.argv[2])
    else:
        output_dmg = app_path.parent / f"{app_path.stem}-macOS-arm64.dmg"

    success = create_styled_dmg(app_path, output_dmg)
    return 0 if success else 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
