// Tests for the snowflake ID generator and parser.
import { describe, expect, it } from "vitest";
import { parseSnowflake, SnowflakeGenerator, SNOWFLAKE_EPOCH_MS } from "./snowflake.js";

describe("SnowflakeGenerator", () => {
  it("rejects a worker ID below zero", () => {
    expect(() => new SnowflakeGenerator(-1)).toThrow(RangeError);
  });

  it("rejects a worker ID above the 10-bit limit", () => {
    expect(() => new SnowflakeGenerator(1024)).toThrow(RangeError);
  });

  it("accepts the lowest and highest valid worker IDs", () => {
    expect(() => new SnowflakeGenerator(0)).not.toThrow();
    expect(() => new SnowflakeGenerator(1023)).not.toThrow();
  });

  it("makes IDs that increase in value across calls", () => {
    const generator = new SnowflakeGenerator(1);
    const first = generator.next();
    const second = generator.next();
    expect(second).toBeGreaterThan(first);
  });

  it("makes IDs that are all different across many fast calls", () => {
    const generator = new SnowflakeGenerator(1);
    const ids = new Set<bigint>();
    for (let i = 0; i < 5000; i += 1) {
      ids.add(generator.next());
    }
    expect(ids.size).toBe(5000);
  });

  it("encodes the worker ID so parseSnowflake can read it back", () => {
    const generator = new SnowflakeGenerator(42);
    const id = generator.next();
    expect(parseSnowflake(id).workerId).toBe(42);
  });
});

describe("parseSnowflake", () => {
  it("reads back a timestamp close to the time the ID was made", () => {
    const generator = new SnowflakeGenerator(0);
    const before = Date.now();
    const id = generator.next();
    const after = Date.now();
    const parts = parseSnowflake(id);
    expect(parts.timestampMs).toBeGreaterThanOrEqual(before);
    expect(parts.timestampMs).toBeLessThanOrEqual(after);
  });

  it("reads the timestamp at the custom epoch as time zero", () => {
    const id = 0n;
    expect(parseSnowflake(id).timestampMs).toBe(Number(SNOWFLAKE_EPOCH_MS));
  });

  it("reads back the sequence number from the lowest 12 bits", () => {
    const id = 7n;
    expect(parseSnowflake(id).sequence).toBe(7);
  });
});
