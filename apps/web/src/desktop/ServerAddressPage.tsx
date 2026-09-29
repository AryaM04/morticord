// The first page of the desktop app: the user types the address of a
// server. The app checks that the server answers `GET /api/v1/health` and
// allows this app (CORS_ALLOWED_ORIGINS on the server). Then it keeps the
// address and restarts, so the content policy of the window allows it.
import { useState, type FormEvent } from "react";
import { AuthLayout } from "../components/AuthLayout.js";
import { FormField } from "../components/FormField.js";
import { commands } from "./commands.js";

export function ServerAddressPage() {
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const origin = await commands.checkServer(address.trim());
      await commands.setServerUrl(origin);
    } catch (reason) {
      setError(String(reason));
      setPending(false);
    }
  }

  return (
    <AuthLayout title="Connect to a server">
      <form onSubmit={(event) => void handleSubmit(event)}>
        <FormField
          label="Server address"
          placeholder="chat.example.com"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          error={error}
          autoFocus
          required
        />
        <p className="mb-4 text-xs" style={{ color: "var(--color-text-muted)" }}>
          Type the address of the web app of your server. The app restarts when it connects.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded px-3 py-2 text-sm font-medium"
          style={{ backgroundColor: "var(--color-accent)", color: "white" }}
        >
          {pending ? "Connecting..." : "Connect"}
        </button>
      </form>
    </AuthLayout>
  );
}
