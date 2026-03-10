import { Tray, Menu, nativeImage, BrowserWindow } from 'electron';
import path from 'path';
import { AppState } from './shared/types';

type TrayCommand = 'start' | 'stop' | 'toggle-livekit' | 'quit';

export class TrayManager {
  private tray: Tray | null = null;
  private state: AppState = AppState.Idle;
  private onCommand: (cmd: TrayCommand) => void;
  private currentApp = '';

  constructor(onCommand: (cmd: TrayCommand) => void) {
    this.onCommand = onCommand;
  }

  create(): void {
    // Create a simple 16x16 circle icon (gray = idle)
    this.tray = new Tray(this.getIcon());
    this.tray.setToolTip('Terac Recorder — Idle');
    this.updateMenu();
  }

  setState(state: AppState): void {
    this.state = state;
    this.tray?.setImage(this.getIcon());
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
    return `Terac Recorder — ${stateLabel}${appLabel}`;
  }

  private getIcon(): Electron.NativeImage {
    // Generate colored circle icons programmatically
    const color = {
      [AppState.Idle]: '#888888',
      [AppState.Recording]: '#FF3B30',
      [AppState.Publishing]: '#34C759',
    }[this.state];

    // Create a simple 16x16 PNG with a colored circle
    // Using a data URL for a simple circle
    const size = 16;
    const canvas = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 1}" fill="${color}"/>
    </svg>`;
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(canvas).toString('base64')}`;
    return nativeImage.createFromDataURL(dataUrl).resize({ width: 16, height: 16 });
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
