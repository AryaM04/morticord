// Runs async tasks one after the other for each key. The crypto layer
// uses one key for each peer device and one key for the account, so two
// tasks never use the same Olm session or the account at the same time.

export class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  /** Run `task` after every earlier task with the same key is done. */
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task, task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    });
    return result;
  }
}
