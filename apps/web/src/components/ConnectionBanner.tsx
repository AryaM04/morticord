// A banner shown while the gateway connection is down and retrying.
import { useConnectionState } from "../lib/useRealtime.js";

export function ConnectionBanner() {
  const state = useConnectionState((s) => s.state);
  if (state !== "reconnecting") {
    return null;
  }
  return (
    <div role="status" className="px-3 py-2 text-center text-sm" style={{ backgroundColor: "#5c3d00", color: "#ffe0a3" }}>
      The connection is lost. The app tries to connect again.
    </div>
  );
}
