// A button that opens the emoji picker. The picker component and its
// emoji dataset load with a dynamic `import()` the first time the user
// opens it, so a user who never opens it never downloads that code.
import { useRef, useState, type ComponentType } from "react";
import type { EmojiPickerProps } from "../emoji/EmojiPicker.js";

type PickerComponent = ComponentType<EmojiPickerProps>;

export function EmojiPickerButton({
  ariaLabel,
  label,
  onPick,
  className,
  style,
}: {
  ariaLabel: string;
  label: React.ReactNode;
  onPick: (emoji: string) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [Picker, setPicker] = useState<PickerComponent | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function toggle(): void {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!Picker) {
      void import("../emoji/EmojiPicker.js").then((mod) => setPicker(() => mod.EmojiPicker));
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className={className}
        style={style}
      >
        {label}
      </button>
      {open && Picker && (
        <Picker
          anchorEl={buttonRef.current}
          onPick={(emoji) => {
            onPick(emoji);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
