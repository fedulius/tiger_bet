class CallbackStore {
  static instance = null;

  #store = new Map();
  #counter = 0;
  #TTL_MS = 1000 * 60 * 30;

  constructor() {
    if (CallbackStore.instance) {
      return CallbackStore.instance;
    }

    CallbackStore.instance = this;
  }

  put(payload, ttlMs = this.#TTL_MS) {
    this.#counter += 1;
    const id = this.#counter.toString(36);

    this.#store.set(id, {
      payload,
      expiresAt: Date.now() + ttlMs,
    });

    return id;
  }

  get(id) {
    if (!this.#store.has(id)) {
      return null;
    }

    const data = this.#store.get(id);

    if (Date.now() > data.expiresAt) {
      this.#store.delete(id);
      return null;
    }

    return data.payload;
  }
}

module.exports = CallbackStore;
