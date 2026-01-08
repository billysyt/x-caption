#!/usr/bin/env python3
"""
Build macOS .app bundle, sign it, create DMG, and notarize.

Requirements:
1. Apple Developer Account with valid certificates
2. Xcode Command Line Tools: xcode-select --install
3. Environment variables:
   - APPLE_SIGNING_IDENTITY: Your Developer ID Application certificate name
   - APPLE_ID: Your Apple ID email
   - APPLE_APP_PASSWORD: App-specific password (from appleid.apple.com)
   - APPLE_TEAM_ID: Your Apple Developer Team ID

Usage:
    python scripts/build_macos.py --sign --notarize
    python scripts/build_macos.py --sign-only
    python scripts/build_macos.py --no-sign  # For testing only
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path
import shutil


class Colors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'


def log_info(msg: str):
    print(f"{Colors.OKBLUE}[INFO]{Colors.ENDC} {msg}")


def log_success(msg: str):
    print(f"{Colors.OKGREEN}[SUCCESS]{Colors.ENDC} {msg}")


def log_warning(msg: str):
    print(f"{Colors.WARNING}[WARNING]{Colors.ENDC} {msg}")


def log_error(msg: str):
    print(f"{Colors.FAIL}[ERROR]{Colors.ENDC} {msg}")


def log_header(msg: str):
    print(f"\n{Colors.HEADER}{Colors.BOLD}{'=' * 60}")
    print(f"  {msg}")
    print(f"{'=' * 60}{Colors.ENDC}\n")


def run_command(cmd: list, cwd: Path = None, check: bool = True, env: dict = None) -> subprocess.CompletedProcess:
    """Run a shell command and return the result."""
    log_info(f"Running: {' '.join(cmd)}")
    result = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        env=env or os.environ.copy(),
    )
    if check and result.returncode != 0:
        log_error(f"Command failed with exit code {result.returncode}")
        log_error(f"STDOUT: {result.stdout}")
        log_error(f"STDERR: {result.stderr}")
        sys.exit(1)
    return result


def get_project_root() -> Path:
    """Get the project root directory."""
    return Path(__file__).resolve().parent.parent


def get_python_executable() -> str:
    """Get the correct Python executable (preferring venv if available)."""
    root = get_project_root()

    # Check for virtual environments
    venv_paths = [
        root / ".venv" / "bin" / "python3",
        root / ".venv" / "bin" / "python",
        root / "venv" / "bin" / "python3",
        root / "venv" / "bin" / "python",
    ]

    for venv_python in venv_paths:
        if venv_python.exists():
            log_info(f"Using virtual environment Python: {venv_python}")
            return str(venv_python)

    # Fallback to current Python
    log_warning(f"No virtual environment found, using: {sys.executable}")
    return sys.executable


def check_macos():
    """Verify we're running on macOS."""
    if sys.platform != "darwin":
        log_error("This script must run on macOS")
        sys.exit(1)


def check_signing_requirements(signing_identity: str = None) -> bool:
    """Check if code signing requirements are met."""
    if not signing_identity:
        log_warning("No signing identity provided, skipping code signing checks")
        return False

    # Check if the certificate exists
    result = run_command(
        ["security", "find-identity", "-v", "-p", "codesigning"],
        check=False
    )

    if signing_identity not in result.stdout:
        log_error(f"Signing identity '{signing_identity}' not found in keychain")
        log_info("Available identities:")
        print(result.stdout)
        return False

    log_success(f"Found signing identity: {signing_identity}")
    return True


def build_ui(root: Path):
    """Build the React UI."""
    log_header("Building React UI")
    build_ui_script = root / "scripts" / "build_ui.py"
    if not build_ui_script.exists():
        log_error(f"Missing build_ui.py script: {build_ui_script}")
        sys.exit(1)

    python_exe = get_python_executable()
    run_command([python_exe, str(build_ui_script)], cwd=root)
    log_success("UI built successfully")


def build_app_bundle(root: Path):
    """Build the .app bundle using PyInstaller."""
    log_header("Building .app Bundle with PyInstaller")

    spec_file = root / "xcaption_native.spec"
    if not spec_file.exists():
        log_error(f"Missing PyInstaller spec: {spec_file}")
        sys.exit(1)

    python_exe = get_python_executable()
    run_command(
        [python_exe, "-m", "PyInstaller", str(spec_file), "--clean", "--noconfirm"],
        cwd=root
    )

    app_path = root / "dist" / "X-Caption.app"
    if not app_path.exists():
        log_error(f"App bundle not created: {app_path}")
        sys.exit(1)

    log_success(f"App bundle created: {app_path}")

    # Clean up redundant x-caption folder (PyInstaller creates both folder and .app)
    redundant_folder = root / "dist" / "x-caption"
    if redundant_folder.exists():
        log_info(f"Cleaning up redundant folder: {redundant_folder.name}")
        shutil.rmtree(redundant_folder)
        log_success("Cleaned up redundant build artifacts")

    return app_path


def sign_app(app_path: Path, signing_identity: str, entitlements: Path):
    """Code sign the .app bundle with hardened runtime."""
    log_header("Code Signing App Bundle")

    if not entitlements.exists():
        log_error(f"Entitlements file not found: {entitlements}")
        sys.exit(1)

    # Sign all dylibs, frameworks, and executables inside the app
    log_info("Signing all libraries and frameworks...")

    # Find all files to sign
    files_to_sign = []

    # Find .dylib files
    for dylib in app_path.rglob("*.dylib"):
        files_to_sign.append(dylib)

    # Find .so files
    for so in app_path.rglob("*.so"):
        files_to_sign.append(so)

    # Find executables in Frameworks
    frameworks_dir = app_path / "Contents" / "Frameworks"
    if frameworks_dir.exists():
        for item in frameworks_dir.rglob("*"):
            if item.is_file() and os.access(item, os.X_OK):
                files_to_sign.append(item)

    # Sign each file
    for file_path in files_to_sign:
        log_info(f"Signing: {file_path.name}")
        run_command([
            "codesign",
            "--force",
            "--sign", signing_identity,
            "--timestamp",
            "--options", "runtime",
            str(file_path)
        ], check=False)  # Don't fail if individual files can't be signed

    # Sign the main app bundle
    log_info("Signing main app bundle...")
    run_command([
        "codesign",
        "--force",
        "--sign", signing_identity,
        "--entitlements", str(entitlements),
        "--timestamp",
        "--options", "runtime",
        "--deep",
        str(app_path)
    ])

    # Verify signature
    log_info("Verifying signature...")
    run_command(["codesign", "--verify", "--verbose=4", str(app_path)])
    run_command(["spctl", "--assess", "--verbose=4", "--type", "execute", str(app_path)])

    log_success("App bundle signed successfully")


def create_dmg(app_path: Path, output_dmg: Path, volume_name: str = "X-Caption"):
    """Create a professionally styled DMG file from the .app bundle."""
    log_header("Creating Professional DMG")

    # Use the styled DMG creator
    from pathlib import Path
    import sys

    # Import the styled DMG creator
    script_dir = Path(__file__).parent
    styled_dmg_script = script_dir / "create_styled_dmg.py"

    if not styled_dmg_script.exists():
        log_warning("Styled DMG creator not found, using simple DMG creation")
        return create_simple_dmg(app_path, output_dmg, volume_name)

    # Import and use the styled creator
    sys.path.insert(0, str(script_dir))
    try:
        from create_styled_dmg import create_styled_dmg
        success = create_styled_dmg(app_path, output_dmg, volume_name)
        if success:
            log_success(f"DMG created: {output_dmg}")
            return output_dmg
        else:
            log_error("DMG creation failed")
            sys.exit(1)
    except Exception as e:
        log_error(f"Error creating styled DMG: {e}")
        log_info("Falling back to simple DMG creation")
        return create_simple_dmg(app_path, output_dmg, volume_name)


def create_simple_dmg(app_path: Path, output_dmg: Path, volume_name: str = "X-Caption"):
    """Create a simple DMG file (fallback method)."""
    # Remove existing DMG if it exists
    if output_dmg.exists():
        log_info(f"Removing existing DMG: {output_dmg}")
        output_dmg.unlink()

    # Create temporary directory for DMG contents
    temp_dmg_dir = app_path.parent / "dmg_temp"
    if temp_dmg_dir.exists():
        shutil.rmtree(temp_dmg_dir)
    temp_dmg_dir.mkdir()

    # Copy app to temp directory
    log_info("Copying app to temporary DMG directory...")
    shutil.copytree(app_path, temp_dmg_dir / app_path.name, symlinks=True)

    # Create Applications symlink
    applications_link = temp_dmg_dir / "Applications"
    applications_link.symlink_to("/Applications")

    # Create DMG using hdiutil
    log_info("Creating DMG image...")
    run_command([
        "hdiutil", "create",
        "-volname", volume_name,
        "-srcfolder", str(temp_dmg_dir),
        "-ov",
        "-format", "UDZO",
        "-imagekey", "zlib-level=9",
        str(output_dmg)
    ])

    # Clean up temp directory
    shutil.rmtree(temp_dmg_dir)

    if not output_dmg.exists():
        log_error(f"DMG creation failed: {output_dmg}")
        sys.exit(1)

    log_success(f"DMG created: {output_dmg}")
    return output_dmg


def sign_dmg(dmg_path: Path, signing_identity: str):
    """Code sign the DMG."""
    log_header("Signing DMG")

    run_command([
        "codesign",
        "--sign", signing_identity,
        "--timestamp",
        str(dmg_path)
    ])

    # Verify DMG signature
    run_command(["codesign", "--verify", "--verbose=4", str(dmg_path)])

    log_success("DMG signed successfully")


def notarize_dmg(dmg_path: Path, apple_id: str, app_password: str, team_id: str):
    """Notarize the DMG with Apple."""
    log_header("Notarizing DMG with Apple")

    log_info("Submitting DMG for notarization...")
    log_warning("This may take several minutes...")

    # Submit for notarization
    result = run_command([
        "xcrun", "notarytool", "submit",
        str(dmg_path),
        "--apple-id", apple_id,
        "--password", app_password,
        "--team-id", team_id,
        "--wait"
    ])

    if "status: Accepted" in result.stdout or "Successfully received submission" in result.stdout:
        log_success("Notarization successful!")

        # Staple the notarization ticket
        log_info("Stapling notarization ticket...")
        run_command(["xcrun", "stapler", "staple", str(dmg_path)])

        # Verify stapling
        run_command(["xcrun", "stapler", "validate", str(dmg_path)])

        log_success("DMG notarized and stapled successfully")
    else:
        log_error("Notarization failed")
        log_error(result.stdout)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Build and sign macOS app")
    parser.add_argument("--sign", action="store_true", help="Sign the app and DMG")
    parser.add_argument("--notarize", action="store_true", help="Notarize the DMG (requires --sign)")
    parser.add_argument("--sign-only", action="store_true", help="Only sign, don't notarize")
    parser.add_argument("--no-sign", action="store_true", help="Skip signing (for testing)")
    parser.add_argument("--output", type=str, help="Output DMG name (default: X-Caption-macOS-arm64.dmg)")

    args = parser.parse_args()

    check_macos()

    root = get_project_root()
    entitlements = root / "macos" / "entitlements.plist"

    # Determine signing settings
    should_sign = args.sign or args.sign_only or args.notarize
    should_notarize = args.notarize and not args.sign_only

    if args.no_sign:
        should_sign = False
        should_notarize = False

    # Get environment variables
    signing_identity = os.environ.get("APPLE_SIGNING_IDENTITY")
    apple_id = os.environ.get("APPLE_ID")
    app_password = os.environ.get("APPLE_APP_PASSWORD")
    team_id = os.environ.get("APPLE_TEAM_ID")

    if should_sign and not signing_identity:
        log_error("APPLE_SIGNING_IDENTITY environment variable not set")
        log_info("Set it to your 'Developer ID Application' certificate name")
        sys.exit(1)

    if should_notarize and (not apple_id or not app_password or not team_id):
        log_error("Missing notarization credentials")
        log_info("Required environment variables:")
        log_info("  - APPLE_ID: Your Apple ID email")
        log_info("  - APPLE_APP_PASSWORD: App-specific password")
        log_info("  - APPLE_TEAM_ID: Your Apple Developer Team ID")
        sys.exit(1)

    # Check signing requirements
    if should_sign:
        if not check_signing_requirements(signing_identity):
            sys.exit(1)

    # Build UI
    build_ui(root)

    # Build app bundle
    app_path = build_app_bundle(root)

    # Sign app
    if should_sign:
        sign_app(app_path, signing_identity, entitlements)
    else:
        log_warning("Skipping code signing (--no-sign)")

    # Determine DMG name
    output_name = args.output or "X-Caption-macOS-arm64.dmg"
    output_dmg = root / "dist" / output_name

    # Create DMG
    dmg_path = create_dmg(app_path, output_dmg)

    # Sign DMG
    if should_sign:
        sign_dmg(dmg_path, signing_identity)

    # Notarize DMG
    if should_notarize:
        notarize_dmg(dmg_path, apple_id, app_password, team_id)
    elif should_sign:
        log_warning("Skipping notarization (use --notarize to enable)")
    else:
        log_warning("Skipping notarization (app not signed)")

    # Final summary
    log_header("Build Complete!")
    print(f"  App Bundle: {app_path}")
    print(f"  DMG File: {dmg_path}")
    print(f"  Signed: {'Yes' if should_sign else 'No'}")
    print(f"  Notarized: {'Yes' if should_notarize else 'No'}")
    print()

    if not should_sign:
        log_warning("App is NOT signed. It will show security warnings.")
        log_info("To sign and notarize, run:")
        log_info("  export APPLE_SIGNING_IDENTITY='Developer ID Application: Your Name (TEAM_ID)'")
        log_info("  export APPLE_ID='your@email.com'")
        log_info("  export APPLE_APP_PASSWORD='xxxx-xxxx-xxxx-xxxx'")
        log_info("  export APPLE_TEAM_ID='YOUR_TEAM_ID'")
        log_info("  python scripts/build_macos.py --sign --notarize")


if __name__ == "__main__":
    main()
