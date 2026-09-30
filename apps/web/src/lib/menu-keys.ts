// Arrow-key focus for a menu. Down and Up move between the menu items. Home
// and End go to the first and the last item. The menu wraps at the ends.
import type { KeyboardEvent } from "react";

export function moveMenuFocus(event: KeyboardEvent<HTMLElement>): void {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
  if (items.length === 0) return;
  event.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  let next = at;
  if (event.key === "Home") next = 0;
  else if (event.key === "End") next = items.length - 1;
  else if (event.key === "ArrowDown") next = (at + 1) % items.length;
  else next = (at - 1 + items.length) % items.length;
  items[next]?.focus();
}
