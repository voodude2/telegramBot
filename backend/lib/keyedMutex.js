const noop = () => {};

/**
 * Serialises async work per key.
 *
 * Chat turns read history, call the model, then write history back. Two messages
 * from the same user arriving close together would otherwise both read the same
 * history and the second write would clobber the first. Every turn for a given
 * session runs through here so they queue instead of racing.
 *
 * The chain entry is deleted once it drains, so idle sessions do not accumulate.
 */
class KeyedMutex {
  constructor() {
    this.chains = new Map();
  }

  run(key, fn) {
    const previous = this.chains.get(key) || Promise.resolve();
    // Run regardless of whether the previous holder resolved or rejected.
    const result = previous.then(fn, fn);

    const tail = result.then(noop, noop).then(() => {
      if (this.chains.get(key) === tail) this.chains.delete(key);
    });
    this.chains.set(key, tail);

    return result;
  }

  get pending() {
    return this.chains.size;
  }
}

module.exports = { KeyedMutex };
