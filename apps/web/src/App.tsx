// Top-level router. See docs/architecture.md section 7 and the M1 build
// notes: /app is protected (redirect to /login when signed out), every
// other auth page is public.
import { useEffect } from "react";
import { Redirect, Route, Switch } from "wouter";
import { AuthCallbackPage } from "./pages/AuthCallbackPage.js";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { RegisterPage } from "./pages/RegisterPage.js";
import { ResetPasswordPage } from "./pages/ResetPasswordPage.js";
import { VerifyEmailPage } from "./pages/VerifyEmailPage.js";
import { AppShell } from "./pages/AppShell.js";
import { session } from "./lib/session.js";
import { useSession } from "./lib/useSession.js";

function FullPageSpinner() {
  return (
    <div className="flex h-full w-full items-center justify-center" style={{ backgroundColor: "var(--color-bg-main)" }}>
      <span style={{ color: "var(--color-text-muted)" }}>Loading...</span>
    </div>
  );
}

function ProtectedApp() {
  const status = useSession((s) => s.status);

  if (status === "loading") {
    return <FullPageSpinner />;
  }
  if (status === "signedOut") {
    return <Redirect to="/login" />;
  }
  return <AppShell />;
}

export function App() {
  useEffect(() => {
    void session.store.getState().init();
  }, []);

  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/verify-email" component={VerifyEmailPage} />
      <Route path="/auth/callback" component={AuthCallbackPage} />
      <Route path="/app" component={ProtectedApp} />
      <Route>
        <Redirect to="/app" />
      </Route>
    </Switch>
  );
}
