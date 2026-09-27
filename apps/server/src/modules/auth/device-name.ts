// Turn a User-Agent header into a short, safe device name.
// The name is shown to the user in their device list, so it must stay
// short and must not carry control characters or raw HTML.

const MAX_DEVICE_NAME_LENGTH = 64;
const FALLBACK_DEVICE_NAME = "Unknown device";

interface UaPattern {
  match: RegExp;
  name: string;
}

// Order matters: check specific patterns before their broader parent.
const OS_PATTERNS: UaPattern[] = [
  { match: /windows/i, name: "Windows" },
  { match: /iphone/i, name: "iPhone" },
  { match: /ipad/i, name: "iPad" },
  { match: /mac os x|macintosh/i, name: "Mac" },
  { match: /android/i, name: "Android" },
  { match: /linux/i, name: "Linux" },
];

const BROWSER_PATTERNS: UaPattern[] = [
  { match: /edg\//i, name: "Edge" },
  { match: /opr\/|opera/i, name: "Opera" },
  { match: /chrome\//i, name: "Chrome" },
  { match: /firefox\//i, name: "Firefox" },
  { match: /version\/.*safari/i, name: "Safari" },
  { match: /safari/i, name: "Safari" },
];

function firstMatch(patterns: UaPattern[], userAgent: string): string | undefined {
  return patterns.find((pattern) => pattern.match.test(userAgent))?.name;
}

/**
 * Build a short device name from a User-Agent header, such as
 * "Chrome on Windows". Returns a generic fallback for a missing or
 * unrecognized header. The result never exceeds 64 characters.
 */
export function summarizeUserAgent(userAgent: string | undefined): string {
  if (!userAgent) {
    return FALLBACK_DEVICE_NAME;
  }

  // Strip control characters before matching, so a hostile header
  // cannot inject them into the stored name.
  // eslint-disable-next-line no-control-regex -- intentional: strips control bytes from untrusted input
  const cleaned = userAgent.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 512);

  const os = firstMatch(OS_PATTERNS, cleaned);
  const browser = firstMatch(BROWSER_PATTERNS, cleaned);

  let name: string;
  if (browser && os) {
    name = `${browser} on ${os}`;
  } else if (browser) {
    name = browser;
  } else if (os) {
    name = os;
  } else {
    name = FALLBACK_DEVICE_NAME;
  }

  return name.slice(0, MAX_DEVICE_NAME_LENGTH);
}
