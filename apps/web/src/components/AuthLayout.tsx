// A centered card layout shared by every auth page (login, register,
// forgot password, and so on).
import type { ReactNode } from "react";

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main
      className="flex h-full w-full items-center justify-center p-4"
      style={{ backgroundColor: "var(--color-bg-main)" }}
    >
      <div
        className="w-full max-w-sm rounded-lg border p-6"
        style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-sidebar)" }}
      >
        <h1 className="mb-4 text-lg font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}
