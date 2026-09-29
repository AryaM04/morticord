// A banner shown while the gateway connection is down and retrying, and a
// banner shown while another tab of this app runs the encryption.
import { useStore } from "zustand";
import { cryptoTabStore } from "../lib/crypto.js";
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

/** Only one tab of a device runs the crypto layer. The other tabs show this and wait. */
export function CryptoTabBanner() {
  const otherTab = useStore(cryptoTabStore, (s) => s.otherTab);
  if (!otherTab) {
    return null;
  }
  return (
    <div
      role="status"
      data-crypto-other-tab
      className="px-3 py-2 text-center text-sm"
      style={{ backgroundColor: "#5c3d00", color: "#ffe0a3" }}
    >
      Encryption runs in another tab of this app. Use that tab, or close it.
    </div>
  );
}
