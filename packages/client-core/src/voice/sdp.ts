// Pure SDP text edits. These functions never touch a real connection; the
// engine calls `preferOpusFec` on a local description's SDP text right
// before it calls `setLocalDescription` (see engine.ts). Editing the SDP
// at this one point, before it goes anywhere, keeps the offer sent to the
// remote peer and the local description in sync.

const CRLF = "\r\n";

/** Split SDP text into lines, keeping the line ending style the caller used. */
function splitLines(sdp: string): { lines: string[]; usesCrlf: boolean } {
  const usesCrlf = sdp.includes("\r\n");
  const normalized = sdp.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  // A trailing newline splits into one extra empty entry. Drop it, and add
  // it back on join so the output has the same trailing newline as the input.
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return { lines, usesCrlf };
}

function joinLines(lines: string[], usesCrlf: boolean): string {
  const ending = usesCrlf ? CRLF : "\n";
  return lines.join(ending) + ending;
}

/** The index range [start, end) of one m= section, end exclusive (or lines.length for the last section). */
function findMediaSection(lines: string[], mediaType: string): { start: number; end: number } | null {
  const start = lines.findIndex((line) => line.startsWith(`m=${mediaType}`));
  if (start === -1) {
    return null;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i]!.startsWith("m=")) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** Find the opus payload type from an `a=rtpmap:<pt> opus/48000/2` line in the given range. */
function findOpusPayloadType(lines: string[], start: number, end: number): string | null {
  for (let i = start; i < end; i += 1) {
    const match = /^a=rtpmap:(\d+) opus\/48000\/2/i.exec(lines[i]!);
    if (match) {
      return match[1]!;
    }
  }
  return null;
}

/** Merge the FEC and DTX params into an existing fmtp parameter list, without duplicate keys. */
function mergeFmtpParams(existing: string): string {
  const params = new Map<string, string>();
  for (const part of existing.split(";")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      params.set(trimmed, "");
    } else {
      params.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
    }
  }
  params.set("useinbandfec", "1");
  params.set("usedtx", "1");
  params.set("stereo", "0");
  return [...params.entries()].map(([key, value]) => (value === "" ? key : `${key}=${value}`)).join(";");
}

/**
 * Set `useinbandfec=1;usedtx=1;stereo=0` on the opus fmtp line of an SDP.
 * This turns on Opus in-band forward error correction and discontinuous
 * transmission, and forces mono, for every offer and answer this client
 * builds. Every other codec, and the video section, is left untouched.
 */
export function preferOpusFec(sdp: string): string {
  const { lines, usesCrlf } = splitLines(sdp);
  const audioSection = findMediaSection(lines, "audio");
  if (!audioSection) {
    return sdp;
  }
  const payloadType = findOpusPayloadType(lines, audioSection.start, audioSection.end);
  if (!payloadType) {
    return sdp;
  }

  const fmtpPrefix = `a=fmtp:${payloadType} `;
  let fmtpIndex = -1;
  for (let i = audioSection.start; i < audioSection.end; i += 1) {
    if (lines[i]!.startsWith(fmtpPrefix)) {
      fmtpIndex = i;
      break;
    }
  }

  const nextLines = [...lines];
  if (fmtpIndex === -1) {
    // No fmtp line yet for opus: add one right after its rtpmap line.
    const rtpmapIndex = lines.findIndex(
      (line, i) => i >= audioSection.start && i < audioSection.end && line.startsWith(`a=rtpmap:${payloadType} `),
    );
    nextLines.splice(rtpmapIndex + 1, 0, `${fmtpPrefix}useinbandfec=1;usedtx=1;stereo=0`);
  } else {
    const existingParams = lines[fmtpIndex]!.slice(fmtpPrefix.length);
    nextLines[fmtpIndex] = `${fmtpPrefix}${mergeFmtpParams(existingParams)}`;
  }

  return joinLines(nextLines, usesCrlf);
}

/**
 * Apply `preferOpusFec` to a session description's SDP text, returning a
 * new description object. Used right before `setLocalDescription`.
 */
export function applyOpusFec(description: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
  if (!description.sdp) {
    return description;
  }
  return { ...description, sdp: preferOpusFec(description.sdp) };
}

/**
 * Cap an RTP sender's outgoing bitrate. Used for the audio sender once it
 * exists, with `maxBitrateBps` set to the engine's fixed audio cap.
 */
export async function capOpusBitrate(sender: RTCRtpSender, maxBitrateBps: number): Promise<void> {
  const parameters = sender.getParameters();
  if (!parameters.encodings || parameters.encodings.length === 0) {
    parameters.encodings = [{}];
  }
  for (const encoding of parameters.encodings) {
    encoding.maxBitrate = maxBitrateBps;
  }
  await sender.setParameters(parameters);
}
