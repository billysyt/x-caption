#!/bin/bash
# Setup helper for macOS building

set -e

echo "==================================================================="
echo "  X-Caption macOS Build Setup"
echo "==================================================================="
echo ""

# Check if we're on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "❌ Error: This script must run on macOS"
    exit 1
fi

echo "✅ Running on macOS"

# Check Xcode Command Line Tools
if ! xcode-select -p &>/dev/null; then
    echo "⚠️  Xcode Command Line Tools not found"
    echo "   Installing..."
    xcode-select --install
    echo "   Please run this script again after installation completes"
    exit 0
else
    echo "✅ Xcode Command Line Tools installed"
fi

# Check Python
if ! command -v python3 &>/dev/null; then
    echo "❌ Python 3 not found"
    exit 1
fi
echo "✅ Python 3: $(python3 --version)"

# Check for virtual environment
VENV_PATH=""
if [ -d ".venv" ]; then
    VENV_PATH=".venv"
    echo "✅ Found virtual environment: .venv"
elif [ -d "venv" ]; then
    VENV_PATH="venv"
    echo "✅ Found virtual environment: venv"
fi

# Check PyInstaller
if [ -n "$VENV_PATH" ]; then
    # Check in virtual environment
    if ! "$VENV_PATH/bin/python" -c "import PyInstaller" 2>/dev/null; then
        echo "⚠️  PyInstaller not found in virtual environment"
        echo "   Installing..."
        "$VENV_PATH/bin/pip" install pyinstaller
    else
        echo "✅ PyInstaller installed in virtual environment"
    fi
else
    # Check globally
    if ! python3 -c "import PyInstaller" 2>/dev/null; then
        echo "⚠️  PyInstaller not found"
        echo "   Please install in your virtual environment:"
        echo "     pip install pyinstaller"
        echo "   Or activate your virtual environment first"
    else
        echo "✅ PyInstaller installed"
    fi
fi

# Check for signing identities
echo ""
echo "Checking for code signing identities..."
IDENTITIES=$(security find-identity -v -p codesigning 2>/dev/null | grep "Developer ID Application" || true)

if [ -z "$IDENTITIES" ]; then
    echo "⚠️  No 'Developer ID Application' certificate found"
    echo ""
    echo "To create a signed and notarized app (no security warnings):"
    echo "1. Join Apple Developer Program ($99/year): https://developer.apple.com"
    echo "2. Create a 'Developer ID Application' certificate"
    echo "3. Download and install it in Keychain Access"
    echo ""
    echo "You can still build unsigned apps for testing:"
    echo "  python scripts/build_macos.py --no-sign"
else
    echo "✅ Found Developer ID certificates:"
    echo "$IDENTITIES"
    echo ""

    # Extract the first identity
    FIRST_IDENTITY=$(echo "$IDENTITIES" | head -n1 | sed 's/.*"\(.*\)".*/\1/')

    echo "Suggested environment variables:"
    echo ""
    echo "export APPLE_SIGNING_IDENTITY=\"$FIRST_IDENTITY\""
    echo "export APPLE_ID=\"your@email.com\""
    echo "export APPLE_APP_PASSWORD=\"xxxx-xxxx-xxxx-xxxx\""
    echo "export APPLE_TEAM_ID=\"YOUR_TEAM_ID\""
    echo ""
    echo "💡 Tip: Save these to .env.macos and run: source .env.macos"
fi

echo ""
echo "==================================================================="
echo "  Setup Complete!"
echo "==================================================================="
echo ""
echo "Next steps:"
echo ""
if [ -z "$IDENTITIES" ]; then
    echo "1. Build unsigned app (for testing):"
    echo "     python scripts/build_macos.py --no-sign"
    echo ""
    echo "2. Or get Apple Developer certificate to build signed app"
else
    echo "1. Set environment variables (see above)"
    echo ""
    echo "2. Build signed and notarized DMG:"
    echo "     python scripts/build_macos.py --sign --notarize"
    echo ""
    echo "3. Or build signed only (faster, for testing):"
    echo "     python scripts/build_macos.py --sign-only"
fi
echo ""
echo "For detailed instructions, see: macos/BUILD.md"
echo ""
