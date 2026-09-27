// Snowflake ID generator and parser.
// A snowflake ID is a 64-bit integer. It sorts by creation time.
// Bit layout, from the highest bit to the lowest bit:
//   42 bits: milliseconds since the custom epoch
//   10 bits: worker ID (0 to 1023)
//   12 bits: sequence number inside one millisecond (0 to 4095)

// The custom epoch is 2026-01-01T00:00:00.000Z, in milliseconds since Unix epoch.
export const SNOWFLAKE_EPOCH_MS = 1767225600000n;

const WORKER_ID_BITS = 10n;
const SEQUENCE_BITS = 12n;
const MAX_WORKER_ID = (1n << WORKER_ID_BITS) - 1n;
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n;
const WORKER_ID_SHIFT = SEQUENCE_BITS;
const TIMESTAMP_SHIFT = SEQUENCE_BITS + WORKER_ID_BITS;

export interface SnowflakeParts {
  timestampMs: number;
  workerId: number;
  sequence: number;
}

/** A generator makes unique, sortable IDs for one worker process. */
export class SnowflakeGenerator {
  private readonly workerId: bigint;
  private lastTimestampMs = -1n;
  private sequence = 0n;

  constructor(workerId: number) {
    if (workerId < 0 || BigInt(workerId) > MAX_WORKER_ID) {
      throw new RangeError(`Worker ID must be between 0 and ${MAX_WORKER_ID}.`);
    }
    this.workerId = BigInt(workerId);
  }

  /** Make one new snowflake ID. This method is safe to call fast, in a loop. */
  next(): bigint {
    let nowMs = BigInt(Date.now());

    if (nowMs < this.lastTimestampMs) {
      // The clock moved back. Wait until time passes the last known value.
      nowMs = this.lastTimestampMs;
    }

    if (nowMs === this.lastTimestampMs) {
      this.sequence = (this.sequence + 1n) & MAX_SEQUENCE;
      if (this.sequence === 0n) {
        // The sequence wrapped. Wait for the next millisecond.
        while (nowMs <= this.lastTimestampMs) {
          nowMs = BigInt(Date.now());
        }
      }
    } else {
      this.sequence = 0n;
    }

    this.lastTimestampMs = nowMs;

    const epochOffset = nowMs - SNOWFLAKE_EPOCH_MS;
    return (epochOffset << TIMESTAMP_SHIFT) | (this.workerId << WORKER_ID_SHIFT) | this.sequence;
  }
}

/** Split a snowflake ID back into its timestamp, worker ID and sequence parts. */
export function parseSnowflake(id: bigint): SnowflakeParts {
  const sequence = id & MAX_SEQUENCE;
  const workerId = (id >> WORKER_ID_SHIFT) & MAX_WORKER_ID;
  const epochOffset = id >> TIMESTAMP_SHIFT;

  return {
    timestampMs: Number(epochOffset + SNOWFLAKE_EPOCH_MS),
    workerId: Number(workerId),
    sequence: Number(sequence),
  };
}
