import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("paopao", {
  saveCapture: (input: unknown) => ipcRenderer.invoke("capture:save", input),
  toggleCapture: () => ipcRenderer.invoke("window:toggle-capture"),
  hideCapture: () => ipcRenderer.invoke("window:hide-capture"),
  openLibrary: () => ipcRenderer.invoke("window:open-library"),
  onPetState: (handler: (state: string) => void) => ipcRenderer.on("pet:state", (_event, state) => handler(state))
});
