// The preload script of the screen picker window. It gives the picker page
// only two functions: get the list of sources, and send the choice.
import { contextBridge, ipcRenderer } from "electron";
import { PICKER_CHOOSE, PICKER_SOURCES, type PickerSource } from "../shared/channels.js";

contextBridge.exposeInMainWorld("pickerBridge", {
  sources: () => ipcRenderer.invoke(PICKER_SOURCES) as Promise<PickerSource[]>,
  choose: (id: unknown) => ipcRenderer.send(PICKER_CHOOSE, typeof id === "string" ? id : null),
});
