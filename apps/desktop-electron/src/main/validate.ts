// Checks for the arguments of each IPC call. The app window is not
// trusted more than a web page: each value that comes through IPC is
// checked here before the main process uses it. A check throws an
// `ArgumentError` with a plain message.

export class ArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgumentError";
  }
}

/** A text of at most `max` characters. */
export function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.length > max) {
    throw new ArgumentError(`The ${name} is not valid.`);
  }
  return value;
}

/** A text of at most `max` characters, or null. */
export function textOrNull(value: unknown, name: string, max: number): string | null {
  return value === null ? null : text(value, name, max);
}

/** A text that matches a pattern. */
export function matching(value: unknown, name: string, pattern: RegExp, max: number): string {
  const checked = text(value, name, max);
  if (!pattern.test(checked)) {
    throw new ArgumentError(`The ${name} is not valid.`);
  }
  return checked;
}

export function bool(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new ArgumentError(`The ${name} is not valid.`);
  }
  return value;
}

/** A whole number from `min` to `max`. */
export function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ArgumentError(`The ${name} is not valid.`);
  }
  return value;
}

/** An http or https URL of at most 2048 characters. Returns the parsed URL. */
export function webUrl(value: unknown, name: string): URL {
  const raw = text(value, name, 2048);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ArgumentError(`The ${name} is not valid.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ArgumentError(`The ${name} is not valid.`);
  }
  return url;
}

/** The key names of the secure store: the same rule as the Tauri app. */
export const SECURE_KEY = /^[A-Za-z0-9_:.-]{1,128}$/;
/** The largest value in the secure store. The real values (tokens, a key) are much smaller. */
export const MAX_SECURE_VALUE = 16 * 1024;
/** A notification id from the web app, such as "k3j9x0n12". */
export const NOTIFICATION_ID = /^[a-z0-9]{1,40}$/;
/** A push-to-talk shortcut such as "Control+Shift+KeyT". The full check is in push-to-talk.ts. */
export const SHORTCUT = /^(?:(?:Control|Alt|Shift|Super)\+){0,4}[A-Za-z0-9]{1,24}$/;
