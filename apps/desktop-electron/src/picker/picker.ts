// The page of the screen picker window. It shows the screens and windows
// that the main process sends, and sends back the choice of the user.
import type { PickerSource } from "../shared/channels.js";

interface PickerBridge {
  sources(): Promise<PickerSource[]>;
  choose(id: string | null): void;
}

const bridge = (window as unknown as { pickerBridge: PickerBridge }).pickerBridge;
const list = document.getElementById("sources")!;
const status = document.getElementById("status")!;

document.getElementById("cancel")!.addEventListener("click", () => bridge.choose(null));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    bridge.choose(null);
  }
});

void bridge.sources().then((sources) => {
  status.textContent = sources.length > 0 ? "" : "No screen or window is available to share.";
  for (const source of sources) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const image = document.createElement("img");
    image.src = source.thumbnail;
    image.alt = "";
    const name = document.createElement("span");
    name.textContent = source.name;
    button.append(image, name);
    button.addEventListener("click", () => bridge.choose(source.id));
    item.append(button);
    list.append(item);
  }
  list.querySelector("button")?.focus();
});
