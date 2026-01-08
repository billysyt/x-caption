<div align="center">
  <img src="assets/logo.png" alt="X-Caption" width="120" height="120" />
  <h1>X-Caption</h1>
  <p>Offline speech workspace for fast, private transcription with Whisper.cpp.</p>

  <p>
    <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-111111" />
    <img alt="offline" src="https://img.shields.io/badge/offline-first-0b6b3a" />
    <img alt="gpu" src="https://img.shields.io/badge/gpu-CUDA%20%7C%20Vulkan%20%7C%20Metal-114b5f" />
  </p>

  <p>
    <a href="#download">Download</a> ·
    <a href="#quick-start">Quick Start</a> ·
    <a href="#contributing">Contributing</a>
  </p>
</div>

---

## Why X-Caption
X-Caption is a lightweight desktop studio for transcribing **audio and video** completely on-device. No subscriptions, no per‑minute fees, and no uploading your media to online transcription services. It delivers the core features you need while keeping everything private and local.

<p align="center">
  <img src="assets/app.gif" alt="X-Caption walkthrough" width="640" />
</p>

## Highlights
- Offline, privacy-first transcription powered by Whisper.cpp.
- GPU acceleration: NVIDIA (CUDA), AMD (Vulkan), Apple Silicon (Metal).
- Cantonese enhancement and colloquial-to-formal conversion.
- Traditional/Simplified Chinese transcript conversion.
- Unlimited usage, SRT export, and more.
- One‑click import/download from mainstream platforms (YouTube, Bilibili, Instagram, Douyin, etc.).

## Download
Get the latest release builds from GitHub Releases.

<p align="left"><a href="https://github.com/billysyt/x-caption/releases/latest"><img src="assets/badge-macos.svg" alt="Download for macOS" width="156" height="52" /></a>&nbsp;&nbsp;<a href="https://github.com/billysyt/x-caption/releases/latest"><img src="assets/badge-windows.svg" alt="Download for Windows" width="156" height="52" /></a></p>

Note: macOS M‑series is supported. Intel Mac (older models) has not been tested.

## Quick Start
1. Install Python 3.12 and create a virtual environment:
   ```bash
   python3.12 -m venv .venv
   ```
2. Activate the environment and install dependencies:
   ```bash
   # macOS / Linux
   source .venv/bin/activate

   # Windows
   .venv\\Scripts\\activate

   pip install -r requirements.txt
   ```
3. Start development:
   ```bash
   python scripts/dev.py
   ```

## Comparison
Quick comparison of X-Caption with other popular platforms.

<table width="100%">
  <thead>
    <tr>
      <th align="left">Feature</th>
      <th align="left"><strong>X-Caption</strong></th>
      <th align="left">Subtitle Studio</th>
      <th align="left">CantoSub</th>
      <th align="left">Subanana</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Open Source</td>
      <td><strong>✓</strong></td>
      <td>✗</td>
      <td>✗</td>
      <td>✗</td>
    </tr>
    <tr>
      <td>Pricing</td>
      <td><strong>Free</strong></td>
      <td>~ HKD 550 lifetime</td>
      <td>HKD 300 / month<br />HKD 2,700 / year</td>
      <td>HKD 480 / month<br />HKD 4,800 / year</td>
    </tr>
    <tr>
      <td>Usage Limit (hours/month)</td>
      <td><strong>Unlimited</strong></td>
      <td>Unlimited</td>
      <td>10 hours</td>
      <td>8 hours</td>
    </tr>
    <tr>
      <td>Per-file Size Limit</td>
      <td><strong>Unlimited</strong></td>
      <td>Unlimited</td>
      <td>5 GB</td>
      <td>15 GB</td>
    </tr>
    <tr>
      <td>Total Storage</td>
      <td><strong>Unlimited</strong></td>
      <td>Unlimited</td>
      <td>100 GB</td>
      <td>Limited</td>
    </tr>
    <tr>
      <td>Processing time (1h video)</td>
      <td><strong>&lt; 10 min</strong></td>
      <td>&lt; 10 min</td>
      <td>~14 min</td>
      <td>~110 min</td>
    </tr>
    <tr>
      <td>Accuracy</td>
      <td><strong>Good (90%+)</strong></td>
      <td>Good (90%+)</td>
      <td>Good (90%+)</td>
      <td>Good (90%+)</td>
    </tr>
    <tr>
      <td>Offline Privacy & Security</td>
      <td><strong>✓</strong></td>
      <td>✓</td>
      <td>✗</td>
      <td>✗</td>
    </tr>
    <tr>
      <td>Real-time Editor</td>
      <td><strong>✓</strong></td>
      <td>✓</td>
      <td>✓</td>
      <td>✓</td>
    </tr>
    <tr>
      <td>Cantonese → written/spoken</td>
      <td><strong>✓</strong></td>
      <td>✗ Not configurable</td>
      <td>✓</td>
      <td>✓</td>
    </tr>
    <tr>
      <td>Audio or Video files</td>
      <td><strong>✓</strong></td>
      <td>✗ Video only</td>
      <td>✓</td>
      <td>✓</td>
    </tr>
    <tr>
      <td>TC/SC SRT Download</td>
      <td><strong>✓</strong></td>
      <td>✓</td>
      <td>✓</td>
      <td>✓</td>
    </tr>
    <tr>
      <td>Local Transcript History</td>
      <td><strong>✓</strong></td>
      <td>✗</td>
      <td>✗</td>
      <td>✗</td>
    </tr>
    <tr>
      <td>Stream from YouTube</td>
      <td><strong>✓</strong></td>
      <td>✗</td>
      <td>✗</td>
      <td>✗</td>
    </tr>
    <tr>
      <td>Import from URL</td>
      <td><strong>✓</strong></td>
      <td>✗</td>
      <td>✗</td>
      <td>✗</td>
    </tr>
    <tr>
      <td>Multi-language Translation</td>
      <td><strong>✓</strong></td>
      <td>✓</td>
      <td>✓</td>
      <td>✓</td>
    </tr>
  </tbody>
</table>

## Contributing
Issues and pull requests are welcome. If you plan a larger change, open a discussion first so we can align on scope and approach.
