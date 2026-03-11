# Caret Desktop Recorder

Background screen recording + system audio capture desktop app with LiveKit WebRTC integration. Built with Electron, TypeScript, and a native Swift sidecar for macOS accessibility APIs.

- **Screen + system audio capture** via ScreenCaptureKit (macOS 13+), no virtual audio driver needed
- **LiveKit WebRTC publishing** — publish/unpublish screen share tracks without interrupting local recording
- **Gapless segment rotation** — dual overlapping MediaRecorder instances for seamless 5-minute WebM chunks
- **Swift accessibility sidecar** — real-time a11y tree traversal with 13 app-specific parsers (Chrome, Slack, Zoom, etc.)
- **Menu bar app** — system tray UI with 3-state icons, no Dock presence
- **75 tests** covering capture, recording, LiveKit, tray, sidecar crash recovery, and shutdown ordering

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ Electron App                                        │
│                                                     │
│  Main Process                                       │
│  ├── Tray (system tray menu, 3 states)              │
│  ├── SidecarManager (spawn/restart Swift binary)    │
│  ├── IPC handlers (file I/O, state relay)           │
│  └── App lifecycle (flags, permissions, shutdown)    │
│                                                     │
│  Renderer Process (hidden window)                   │
│  ├── capture.ts (getDisplayMedia)                   │
│  ├── recorder.ts (MediaRecorder + segmentation)     │
│  ├── livekit.ts (room + track publish)              │
│  └── renderer.ts (orchestrator)                     │
│                                                     │
│  Preload (contextBridge IPC)                        │
└──────────────┬──────────────────────────────────────┘
               │ spawns
               v
┌──────────────────────────────────────────────────────┐
│ Swift Sidecar (observer-sidecar)                     │
│  ├── A11y APIs (AXUIElement)                         │
│  ├── 13 app parsers (Chrome, Slack, Zoom, etc.)      │
│  ├── HashStore (dedupe)                              │
│  ├── SnapshotCapture (diff)                          │
│  └── stdout: JSON Lines                              │
└──────────────────────────────────────────────────────┘
```

All user interaction via **system tray context menu** (no visible window). The renderer owns MediaStream/MediaRecorder/livekit-client (browser context required). The sidecar communicates via stdio (JSON Lines on stdout).

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Screen capture | `setDisplayMediaRequestHandler` with `useSystemPicker: false` | Auto-grants without picker dialog after initial OS permission |
| System audio | `audio: 'loopback'` + Chromium flags | Native macOS 13+ ScreenCaptureKit, no third-party driver needed |
| Video format | WebM (VP8 + Opus) | MediaRecorder limitation — VP8 is more reliable than VP9 across Electron builds |
| Segment rotation | Dual overlapping MediaRecorder instances | Single stop/start has frame drops; two alternating recorders produce seamless segments |
| Duration fix | `fix-webm-duration` | Chromium bug: MediaRecorder writes WebM without duration metadata |
| Sidecar protocol | stdio JSON Lines | Simpler lifecycle than HTTP/WebSocket, no port conflicts |
| LiveKit context | Data channel (`publishData`) | Separate from media tracks, structured JSON, chunked for >15KB |
| Dock hiding | `app.dock.hide()` + `type: 'panel'` + `LSUIElement` | Prevents dock icon reappearing when BrowserWindow interacts |

## Setup

### Prerequisites

- Node.js 18+
- macOS 14+ (for ScreenCaptureKit audio)
- Xcode Command Line Tools (for Swift sidecar build)

### Build the Swift Sidecar

The sidecar is a Swift executable in `sidecar-swift/` that uses macOS Accessibility APIs to observe the frontmost app.

```bash
cd sidecar-swift
swift build --product caret-sidecar
mkdir -p ../sidecar-bin
cp .build/debug/caret-sidecar ../sidecar-bin/observer-sidecar
```

### Install & Run

```bash
npm install
npm start
```

### LiveKit Configuration

Set environment variables before starting:

```bash
export LIVEKIT_URL=ws://localhost:7880
export LIVEKIT_TOKEN=<your-access-token>
npm start
```

Or use LiveKit's [Meet app](https://meet.livekit.io/) to generate a token for testing.

### Permissions

On first launch, macOS will prompt for:
1. **Screen Recording** — required for capture
2. **Accessibility** — required for the sidecar (a11y tree traversal)

Grant both in System Settings > Privacy & Security. The app may need a restart after granting permissions.

## Usage

1. Launch the app — it appears as a **gray circle** in the menu bar (no Dock icon)
2. Click the tray icon > **Start Recording** — icon turns **red**, segments start saving to `~/Documents/Caret/Recordings/`
3. Click > **Start Publishing** — icon turns **green**, screen + audio publish to LiveKit room
4. Click > **Stop Publishing** — returns to red, local recording continues
5. Click > **Stop Recording** — finalizes last segment, icon returns to gray
6. Click > **Quit** — clean shutdown (flushes final segment)

### Recording Output

```
~/Documents/Caret/Recordings/
├── 2025-01-15T10-30-00-000Z_000.webm   # Video segment 1
├── 2025-01-15T10-30-00-000Z_001.webm   # Video segment 2
└── context-2025-01-15T10-30-00-000Z.jsonl  # Sidecar context data
```

## Project Structure

```
caret-recorder/
├── src/
│   ├── main.ts              — Electron entry, Chromium flags, hidden window, IPC
│   ├── tray.ts              — System tray icon + context menu (3 states)
│   ├── preload.ts           — contextBridge IPC exposure
│   ├── renderer.ts          — Orchestrator (capture + recorder + livekit + sidecar data)
│   ├── capture.ts           — getDisplayMedia wrapper
│   ├── recorder.ts          — Dual MediaRecorder + 5-min segmentation
│   ├── livekit.ts           — LiveKit room + track publish/unpublish/data
│   ├── sidecar/
│   │   ├── sidecar-manager.ts  — Spawn/readline/restart Swift binary
│   │   └── types.ts            — SidecarEvent, payload types
│   └── shared/
│       └── types.ts            — AppState enum, IPC channels, config constants
├── sidecar-swift/           — Swift sidecar source (macOS a11y observer)
│   ├── Package.swift
│   └── Sources/CaretSidecar/
│       ├── main.swift
│       ├── FrontmostAppObserver.swift
│       ├── AccessibilityTraversal.swift
│       ├── Payloads.swift
│       └── JSONOutput.swift
├── sidecar-bin/             — Built sidecar binary (gitignored)
├── forge.config.ts          — Electron Forge + Vite config, extraResource for sidecar
├── index.html               — Minimal shell (hidden window)
└── package.json
```

## Data Flow

```
Screen + Audio → getDisplayMedia → MediaStream
  ├── SegmentedRecorder → WebM segments → disk (~/Documents/Caret/Recordings/)
  └── LiveKitPublisher → Track.Source.ScreenShare + ScreenShareAudio → LiveKit room

Sidecar stdout → SidecarManager.readline → parsed JSON
  ├── IPC → renderer → LiveKit data channel (real-time context)
  ├── disk (context-{timestamp}.jsonl alongside WebM segments)
  └── Main process → tray tooltip (current app name)
```

## Known Limitations

1. **WebM not MP4** — MediaRecorder API limitation in Chromium. VP8+Opus produces WebM; converting to MP4 would require ffmpeg post-processing
2. **System audio requires macOS 13+** — Earlier versions need a virtual audio driver (BlackHole)
3. **Screen Recording permission requires app restart** — macOS caches the grant; first launch may need manual restart
4. **Hidden window appears in capture** — Electron's hidden BrowserWindow is included in full-screen capture (mitigated by 1x1 pixel size + `type: 'panel'`)
5. **No upload** — Segments are saved locally only; background upload is not implemented
6. **Single monitor** — Captures primary display only; multi-monitor selection is not exposed in UI
7. **LiveKit data channel 15KB limit** — Large traversal payloads are chunked automatically, but receiver must reassemble

## Testing

```bash
npm test                        # Run all tests
npm run test:watch              # Watch mode
npm run test:coverage           # Coverage report
npm test -- --reporter=verbose  # See all test names
```

Tests cover: 1080p/30fps capture, system audio, 5-min WebM segments, LiveKit publish/unpublish, system tray states, sidecar crash recovery, and clean shutdown ordering. The sidecar binary integration test runs automatically when the binary is present and is skipped otherwise.

## Improvements

- **Upload pipeline** — Background upload of segments to S3/GCS with retry logic
- **ffmpeg transcoding** — Convert WebM segments to MP4 (H.264+AAC) post-capture for wider compatibility
- **Multi-monitor picker** — Allow selecting which display to capture via tray submenu
- **Performance profiling** — Measure actual CPU/memory impact of dual-recorder approach
- **Auto-reconnect LiveKit** — The SDK handles it, but re-publishing tracks after reconnect needs explicit handling
- **Sidecar binary signing** — Move from `extraResource` to `Frameworks/` for proper macOS code signing
- **End-to-end tests** — Playwright/Spectron for full Electron lifecycle (segment files on disk, LiveKit track presence)
