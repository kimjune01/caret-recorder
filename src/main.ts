import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
  systemPreferences,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import { TrayManager } from './tray';
import { SidecarManager } from './sidecar/sidecar-manager';
import { AppState, IPC, CONFIG, LiveKitConfig } from './shared/types';
import { SidecarEvent, SidecarEventType, FrontmostAppPayload } from './sidecar/types';

// LiveKit config from environment (read in main process where process.env exists)
const livekitConfig: LiveKitConfig = {
  url: process.env.LIVEKIT_URL || 'ws://localhost:7880',
  token: process.env.LIVEKIT_TOKEN || '',
};

if (started) app.quit();

// ---------- Chromium flags (before app.ready) ----------
// Enable system audio loopback for screen capture
app.commandLine.appendSwitch(
  'enable-features',
  'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride,MacCatapSystemAudioLoopbackCapture',
);

// ---------- Globals ----------
let mainWindow: BrowserWindow | null = null;
let tray: TrayManager | null = null;
let sidecar: SidecarManager | null = null;

// Recordings directory
function getRecordingsDir(): string {
  const dir = path.join(app.getPath('documents'), CONFIG.RECORDINGS_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// ---------- Window creation ----------
function createHiddenWindow(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    frame: false,
    type: 'panel',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false, // Required for LiveKit in some Electron builds
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  return win;
}

// ---------- App lifecycle ----------
app.on('ready', () => {
  // Hide from Dock on macOS
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  // Auto-grant screen capture without picker dialog
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        if (sources.length > 0) {
          callback({ video: sources[0], audio: 'loopback' });
        } else {
          console.error('[Main] No screen sources found');
          callback({ video: undefined });
        }
      } catch (err) {
        console.error('[Main] setDisplayMediaRequestHandler error:', err);
        callback({ video: undefined });
      }
    },
    { useSystemPicker: false },
  );

  // Check accessibility permission
  if (process.platform === 'darwin') {
    const screenAccess = systemPreferences.getMediaAccessStatus('screen');
    if (screenAccess !== 'granted') {
      console.warn(
        '[Main] Screen recording permission not granted. Status:',
        screenAccess,
      );
    }
  }

  // Create hidden renderer window
  mainWindow = createHiddenWindow();

  // Create system tray
  tray = new TrayManager((cmd) => {
    if (!mainWindow) return;
    switch (cmd) {
      case 'start':
        mainWindow.webContents.send(IPC.START_RECORDING);
        break;
      case 'stop':
        mainWindow.webContents.send(IPC.STOP_RECORDING);
        break;
      case 'toggle-livekit':
        mainWindow.webContents.send(IPC.TOGGLE_LIVEKIT);
        break;
      case 'quit':
        app.quit();
        break;
    }
  });
  tray.create();

  // Start sidecar
  sidecar = new SidecarManager();
  sidecar.on('event', (event: SidecarEvent) => {
    // Forward to renderer
    mainWindow?.webContents.send(IPC.SIDECAR_EVENT, event);

    // Update tray tooltip with current app name
    if (event.event === SidecarEventType.FrontmostApp) {
      const payload = event.payload as FrontmostAppPayload;
      tray?.setCurrentApp(payload.name);
    }
  });
  sidecar.start();
});

// ---------- IPC handlers ----------

// Save recording segment to disk
ipcMain.handle(
  IPC.SAVE_SEGMENT,
  async (_event, filename: string, data: ArrayBuffer) => {
    const filePath = path.join(getRecordingsDir(), filename);
    await fs.promises.writeFile(filePath, Buffer.from(data));
    console.log(`[Main] Saved segment: ${filePath}`);
  },
);

// Save context data (append mode)
ipcMain.handle(
  IPC.SAVE_CONTEXT,
  async (_event, filename: string, data: string) => {
    const filePath = path.join(getRecordingsDir(), filename);
    await fs.promises.appendFile(filePath, data, 'utf-8');
  },
);

// Provide LiveKit config to renderer
ipcMain.handle(IPC.GET_LIVEKIT_CONFIG, () => livekitConfig);

// Update tray state when renderer reports state change
ipcMain.on(IPC.STATE_CHANGED, (_event, state: AppState) => {
  tray?.setState(state);
});

// ---------- Clean shutdown ----------
app.on('before-quit', async () => {
  // Stop sidecar
  sidecar?.stop();

  // Send stop to renderer and wait briefly for segment finalization
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.STOP_RECORDING);
    // Give recorder time to flush final segment
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
});

app.on('window-all-closed', () => {
  // Menu bar app: don't quit on macOS when window closes
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
