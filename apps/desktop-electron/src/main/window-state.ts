// The size and the position of the app window. The app keeps them in a
// file when the window closes or hides, and uses them at the next start.
// A position that is on no screen (a screen was removed) is not used.

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: Bounds;
  maximized: boolean;
}

export const DEFAULT_SIZE = { width: 1200, height: 800 };
export const MIN_SIZE = { width: 800, height: 600 };

function isBounds(value: unknown): value is Bounds {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const bounds = value as Record<string, unknown>;
  return ["x", "y", "width", "height"].every((key) => Number.isInteger(bounds[key]));
}

/** A kept state that is valid and at least half on one of the screens, else null. */
export function restorableState(stored: unknown, screens: readonly Bounds[]): WindowState | null {
  if (stored === null || typeof stored !== "object") {
    return null;
  }
  const { bounds, maximized } = stored as Partial<WindowState>;
  if (!isBounds(bounds) || bounds.width < MIN_SIZE.width || bounds.height < MIN_SIZE.height) {
    return null;
  }
  const visible = screens.some((screen) => {
    const width = Math.min(bounds.x + bounds.width, screen.x + screen.width) - Math.max(bounds.x, screen.x);
    const height = Math.min(bounds.y + bounds.height, screen.y + screen.height) - Math.max(bounds.y, screen.y);
    return width > 0 && height > 0 && width * height * 2 >= bounds.width * bounds.height;
  });
  return visible ? { bounds, maximized: maximized === true } : null;
}
