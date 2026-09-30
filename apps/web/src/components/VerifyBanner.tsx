// Tells a signed-in person their email is not verified yet, with a
// button to send the verification email again.
import { useState } from "react";
import { describeError } from "../lib/errors.js";
import { useSession } from "../lib/useSession.js";
import { session } from "../lib/session.js";

export function VerifyBanner() {
  const user = useSession((s) => s.user);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!user || user.emailVerified !== false) {
    return null;
  }

  async function handleResend() {
    setPending(true);
    setError(null);
    try {
      await session.store.getState().resendVerification();
      setSent(true);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
      style={{ backgroundColor: "#4a3a1a", color: "#f0d9a0" }}
    >
      <span>
        {sent
          ? "A new verification email is on its way."
          : "Your email address is not verified yet."}
      </span>
      {!sent && (
        <button type="button" onClick={handleResend} disabled={pending} className="underline">
          {pending ? "Sending..." : "Send the email again"}
        </button>
      )}
      {error && <span style={{ color: "var(--color-danger-text)" }}>{error}</span>}
    </div>
  );
}
