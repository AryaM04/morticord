// Sign-in buttons for the OAuth providers the server has turned on. The
// list comes from GET /auth/providers, not a hard-coded guess.
import { useEffect, useState } from "react";
import type { OAuthProvider } from "@discord-clone/shared";
import { session } from "../lib/session.js";

const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  github: "Continue with GitHub",
  google: "Continue with Google",
};

export function OAuthButtons() {
  const [providers, setProviders] = useState<OAuthProvider[]>([]);

  useEffect(() => {
    let cancelled = false;
    session.store
      .getState()
      .getProviders()
      .then((result) => {
        if (!cancelled) setProviders(result.providers);
      })
      .catch(() => {
        // No providers is a normal state (all OAuth apps turned off).
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (providers.length === 0) {
    return null;
  }

  return (
    <div className="mb-4 flex flex-col gap-2">
      {providers.map((provider) => (
        <a
          key={provider}
          href={`/api/v1/auth/oauth/${provider}/start`}
          className="rounded border px-3 py-2 text-center text-sm"
          style={{ borderColor: "var(--color-border)" }}
        >
          {PROVIDER_LABEL[provider]}
        </a>
      ))}
      <div className="my-2 text-center text-xs" style={{ color: "var(--color-text-muted)" }}>
        or
      </div>
    </div>
  );
}
