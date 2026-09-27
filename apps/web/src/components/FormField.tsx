// An accessible labeled input, with the error text linked through
// aria-describedby and aria-invalid set on the input.
import { useId, type InputHTMLAttributes } from "react";

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function FormField({ label, error, id, ...inputProps }: FormFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;

  return (
    <div className="mb-4 flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? "true" : "false"}
        aria-describedby={error ? errorId : undefined}
        className="rounded border px-3 py-2 text-sm"
        style={{
          backgroundColor: "var(--color-bg-main)",
          borderColor: error ? "#e05252" : "var(--color-border)",
          color: "var(--color-text-primary)",
        }}
        {...inputProps}
      />
      {error && (
        <p id={errorId} role="alert" style={{ color: "#e05252" }} className="text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
