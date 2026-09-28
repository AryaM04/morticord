// Loads `VoiceSettingsDialog` with a dynamic `import()` only once it is
// actually opened, per CLAUDE.md's rule to load heavy UI lazily. Renders
// nothing until then, so the dialog's code never reaches a page that
// never opens it.
import { lazy, Suspense } from "react";

const VoiceSettingsDialog = lazy(() =>
  import("./VoiceSettingsDialog.js").then((mod) => ({ default: mod.VoiceSettingsDialog })),
);

export function VoiceSettingsDialogLoader({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <VoiceSettingsDialog open={open} onClose={onClose} />
    </Suspense>
  );
}
