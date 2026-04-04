/**
 * EventBus — lightweight pub/sub.
 *
 * Rules:
 *   • Listeners are called synchronously in registration order.
 *   • Errors in listeners do NOT propagate — they are caught and logged
 *     so one broken listener can't silence the rest.
 *   • off() removes the exact function reference passed to on().
 *   • once() removes itself after first call.
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} listener
   * @returns {() => void}  unsubscribe function
   */
  on(event, listener) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(listener);
    return () => this.off(event, listener);
  }

  /**
   * Subscribe once — auto-removed after first call.
   */
  once(event, listener) {
    const wrapper = (payload) => {
      this.off(event, wrapper);
      listener(payload);
    };
    return this.on(event, wrapper);
  }

  /**
   * Unsubscribe.
   */
  off(event, listener) {
    this._listeners.get(event)?.delete(listener);
  }

  /**
   * Emit an event synchronously.
   * @param {string} event
   * @param {*} [payload]
   */
  emit(event, payload) {
    const listeners = this._listeners.get(event);
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error(`[EventBus] Error in listener for "${event}":`, err);
      }
    }
  }

  /**
   * Remove all listeners for an event (or all events if no argument).
   */
  clear(event) {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }
}
