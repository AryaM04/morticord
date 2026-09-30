// A small in-memory Web Locks fake for the RPC tests: exclusive locks in
// request order, `ifAvailable` and `signal`. Each context (a tab or a
// worker) has its own view, and `kill` releases every lock of a context,
// as the browser does when a tab closes or a worker stops.
import type { LockManagerLike } from "../rpc.js";

type Callback = (lock: unknown) => Promise<unknown> | unknown;

export class FakeLocks {
  private readonly holders = new Map<string, symbol>();
  private readonly queues = new Map<string, Array<() => void>>();

  context(): { locks: LockManagerLike; kill: () => void } {
    const owned = new Set<string>();
    const waiting = new Set<() => void>();
    let dead = false;
    const request = (name: string, second: Callback | { ifAvailable?: boolean; signal?: AbortSignal }, third?: Callback) => {
      const options = typeof second === "function" ? {} : second;
      const callback = (typeof second === "function" ? second : third)!;
      return new Promise<unknown>((resolve, reject) => {
        const run = () => {
          const token = Symbol(name);
          this.holders.set(name, token);
          owned.add(name);
          void (async () => callback({ name }))()
            .then(resolve, reject)
            .finally(() => {
              if (this.holders.get(name) === token) {
                owned.delete(name);
                this.release(name);
              }
            });
        };
        const queue = this.queues.get(name) ?? [];
        if (!this.holders.has(name) && queue.length === 0) {
          run();
          return;
        }
        if (options.ifAvailable) {
          void (async () => callback(null))().then(resolve, reject);
          return;
        }
        const waiter = () => {
          if (!dead) {
            run();
          } else {
            this.release(name);
          }
        };
        queue.push(waiter);
        waiting.add(waiter);
        this.queues.set(name, queue);
        options.signal?.addEventListener("abort", () => {
          const index = queue.indexOf(waiter);
          if (index >= 0) {
            queue.splice(index, 1);
            reject(new DOMException("The request was aborted.", "AbortError"));
          }
        });
      });
    };
    return {
      locks: { request } as LockManagerLike,
      kill: () => {
        dead = true;
        for (const name of owned) {
          this.release(name);
        }
        owned.clear();
        for (const queue of this.queues.values()) {
          for (let index = queue.length - 1; index >= 0; index -= 1) {
            if (waiting.has(queue[index]!)) {
              queue.splice(index, 1);
            }
          }
        }
      },
    };
  }

  held(name: string): boolean {
    return this.holders.has(name);
  }

  private release(name: string): void {
    this.holders.delete(name);
    const next = this.queues.get(name)?.shift();
    next?.();
  }
}
