class MockSocket {
  constructor() {
    this.emitted = [];
    this.listeners = {};
    this.server = {
      to: () => this,
      emit: (event, payload) => {
        this.emit(event, payload);
      },
    };
  }

  emit(event, payload) {
    this.emitted.push({ event, payload });
    const callbacks = this.listeners[event] || [];
    callbacks.forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[mock-socket] listener failed", err);
      }
    });
  }

  on(event, fn) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(fn);
  }

  off(event, fn) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((cb) => cb !== fn);
  }
}

function createMockSocket() {
  return new MockSocket();
}

module.exports = {
  createMockSocket,
};
