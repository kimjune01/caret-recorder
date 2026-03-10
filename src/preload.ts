import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './shared/types';

contextBridge.exposeInMainWorld('terac', {
  // Commands from main process
  onStartRecording: (callback: () => void) =>
    ipcRenderer.on(IPC.START_RECORDING, callback),
  onStopRecording: (callback: () => void) =>
    ipcRenderer.on(IPC.STOP_RECORDING, callback),
  onToggleLiveKit: (callback: () => void) =>
    ipcRenderer.on(IPC.TOGGLE_LIVEKIT, callback),

  // Sidecar events
  onSidecarEvent: (callback: (_event: Electron.IpcRendererEvent, data: unknown) => void) =>
    ipcRenderer.on(IPC.SIDECAR_EVENT, callback),

  // Data to main process
  saveSegment: (filename: string, data: ArrayBuffer) =>
    ipcRenderer.invoke(IPC.SAVE_SEGMENT, filename, data),
  saveContext: (filename: string, data: string) =>
    ipcRenderer.invoke(IPC.SAVE_CONTEXT, filename, data),
  stateChanged: (state: string) =>
    ipcRenderer.send(IPC.STATE_CHANGED, state),

  // Config from main process
  getLiveKitConfig: () =>
    ipcRenderer.invoke(IPC.GET_LIVEKIT_CONFIG),
});
