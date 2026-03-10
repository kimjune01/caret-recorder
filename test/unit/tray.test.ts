import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppState } from '../../src/shared/types';

// --- Hoisted mock state (accessible inside vi.mock factory) ---
const { mockSetImage, mockSetToolTip, mockSetContextMenu, mockDestroy, menuTemplateRef } = vi.hoisted(() => {
  const mockSetImage = vi.fn();
  const mockSetToolTip = vi.fn();
  const mockSetContextMenu = vi.fn();
  const mockDestroy = vi.fn();
  const menuTemplateRef: { value: Array<{ label?: string; enabled?: boolean; type?: string; click?: () => void }> } = { value: [] };
  return { mockSetImage, mockSetToolTip, mockSetContextMenu, mockDestroy, menuTemplateRef };
});

vi.mock('electron', () => {
  const trayInstance = {
    setImage: mockSetImage,
    setToolTip: mockSetToolTip,
    setContextMenu: mockSetContextMenu,
    destroy: mockDestroy,
  };

  // Tray must be a proper constructor
  function Tray() {
    return trayInstance;
  }

  return {
    Tray,
    Menu: {
      buildFromTemplate: vi.fn().mockImplementation((template: Array<{ label?: string; enabled?: boolean; type?: string; click?: () => void }>) => {
        menuTemplateRef.value = template;
        return { items: template };
      }),
    },
    nativeImage: {
      createFromBuffer: vi.fn().mockReturnValue({ _icon: true }),
    },
  };
});

const { TrayManager } = await import('../../src/tray');

describe('TrayManager — system tray states', () => {
  let tray: InstanceType<typeof TrayManager>;
  let onCommand: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    menuTemplateRef.value = [];
    onCommand = vi.fn();
    tray = new TrayManager(onCommand);
  });

  it('create() sets idle tooltip: "Terac Recorder — Idle"', () => {
    tray.create();
    expect(mockSetToolTip).toHaveBeenCalledWith('Terac Recorder — Idle');
  });

  it('setState(Recording) updates tooltip to "Recording"', () => {
    tray.create();
    tray.setState(AppState.Recording);
    expect(mockSetToolTip).toHaveBeenCalledWith('Terac Recorder — Recording');
  });

  it('setState(Publishing) updates tooltip to "Recording + Publishing"', () => {
    tray.create();
    tray.setState(AppState.Publishing);
    expect(mockSetToolTip).toHaveBeenCalledWith('Terac Recorder — Recording + Publishing');
  });

  it('setState() updates the tray icon', () => {
    tray.create();
    mockSetImage.mockClear();

    tray.setState(AppState.Recording);
    expect(mockSetImage).toHaveBeenCalledTimes(1);

    tray.setState(AppState.Publishing);
    expect(mockSetImage).toHaveBeenCalledTimes(2);
  });

  it('menu shows "Start Recording" when idle', () => {
    tray.create();
    const startItem = menuTemplateRef.value.find((i) => i.label === 'Start Recording');
    expect(startItem).toBeDefined();
  });

  it('menu shows "Stop Recording" when recording', () => {
    tray.create();
    tray.setState(AppState.Recording);
    const stopItem = menuTemplateRef.value.find((i) => i.label === 'Stop Recording');
    expect(stopItem).toBeDefined();
  });

  it('Toggle LiveKit is disabled when idle, enabled when recording', () => {
    tray.create();

    // Idle: toggle should be disabled
    const idleToggle = menuTemplateRef.value.find(
      (i) => i.label === 'Start Publishing' || i.label === 'Stop Publishing',
    );
    expect(idleToggle?.enabled).toBe(false);

    // Recording: toggle should be enabled
    tray.setState(AppState.Recording);
    const recToggle = menuTemplateRef.value.find(
      (i) => i.label === 'Start Publishing' || i.label === 'Stop Publishing',
    );
    expect(recToggle?.enabled).toBe(true);
  });

  it('menu has a Quit item', () => {
    tray.create();
    const quitItem = menuTemplateRef.value.find((i) => i.label === 'Quit');
    expect(quitItem).toBeDefined();
  });

  it('menu click handlers fire onCommand', () => {
    tray.create();

    // Click "Start Recording"
    const startItem = menuTemplateRef.value.find((i) => i.label === 'Start Recording');
    startItem?.click?.();
    expect(onCommand).toHaveBeenCalledWith('start');

    // Switch to recording and click "Stop Recording"
    tray.setState(AppState.Recording);
    const stopItem = menuTemplateRef.value.find((i) => i.label === 'Stop Recording');
    stopItem?.click?.();
    expect(onCommand).toHaveBeenCalledWith('stop');
  });

  it('setCurrentApp() updates tooltip with app name', () => {
    tray.create();
    tray.setCurrentApp('VS Code');
    expect(mockSetToolTip).toHaveBeenCalledWith('Terac Recorder — Idle | VS Code');
  });

  it('setCurrentApp() includes app in all states', () => {
    tray.create();
    tray.setCurrentApp('Safari');
    tray.setState(AppState.Recording);
    expect(mockSetToolTip).toHaveBeenCalledWith('Terac Recorder — Recording | Safari');
  });

  it('destroy() cleans up the tray', () => {
    tray.create();
    tray.destroy();
    expect(mockDestroy).toHaveBeenCalled();
  });
});
