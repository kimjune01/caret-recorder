import { Tray, Menu, nativeImage } from 'electron';
import { AppState } from './shared/types';

type TrayCommand = 'start' | 'stop' | 'toggle-livekit' | 'quit';

// Generate a 32x32 RGBA circle icon (renders as 16x16 @2x on macOS retina)
function createCircleIcon(r: number, g: number, b: number): Electron.NativeImage {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 2; // 1px padding

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const offset = (y * size + x) * 4;

      if (dist <= radius) {
        // Inside circle — anti-alias the edge
        const alpha = Math.min(1, radius - dist + 0.5);
        buf[offset] = r;
        buf[offset + 1] = g;
        buf[offset + 2] = b;
        buf[offset + 3] = Math.round(alpha * 255);
      }
      // Outside circle: stays 0,0,0,0 (transparent)
    }
  }

  return nativeImage.createFromBuffer(buf, {
    width: size,
    height: size,
    scaleFactor: 2.0,
  });
}

// Pre-generate all three icons
const ICONS = {
  [AppState.Idle]: createCircleIcon(136, 136, 136),       // gray
  [AppState.Recording]: createCircleIcon(255, 59, 48),     // red
  [AppState.Publishing]: createCircleIcon(52, 199, 89),    // green
};

export class TrayManager {
  private tray: Tray | null = null;
  private state: AppState = AppState.Idle;
  private onCommand: (cmd: TrayCommand) => void;
  private currentApp = '';

  constructor(onCommand: (cmd: TrayCommand) => void) {
    this.onCommand = onCommand;
  }

  create(): void {
    this.tray = new Tray(ICONS[AppState.Idle]);
    this.tray.setToolTip('Caret Recorder — Idle');
    this.updateMenu();
  }

  setState(state: AppState): void {
    this.state = state;
    this.tray?.setImage(ICONS[state]);
    this.tray?.setToolTip(this.getTooltip());
    this.updateMenu();
  }

  setCurrentApp(appName: string): void {
    this.currentApp = appName;
    this.tray?.setToolTip(this.getTooltip());
  }

  private getTooltip(): string {
    const stateLabel = {
      [AppState.Idle]: 'Idle',
      [AppState.Recording]: 'Recording',
      [AppState.Publishing]: 'Recording + Publishing',
    }[this.state];
    const appLabel = this.currentApp ? ` | ${this.currentApp}` : '';
    return `Caret Recorder — ${stateLabel}${appLabel}`;
  }

  private updateMenu(): void {
    const isIdle = this.state === AppState.Idle;
    const isPublishing = this.state === AppState.Publishing;

    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: this.getTooltip(),
        enabled: false,
      },
      { type: 'separator' },
      {
        label: isIdle ? 'Start Recording' : 'Stop Recording',
        click: () => this.onCommand(isIdle ? 'start' : 'stop'),
      },
      {
        label: isPublishing ? 'Stop Publishing' : 'Start Publishing',
        enabled: !isIdle,
        click: () => this.onCommand('toggle-livekit'),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => this.onCommand('quit'),
      },
    ];

    this.tray?.setContextMenu(Menu.buildFromTemplate(template));
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
