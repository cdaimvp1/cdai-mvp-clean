const { expect } = require("@jest/globals");
require("@testing-library/jest-dom");

class MockResizeObserver {
  static instances = new Set();

  constructor(callback) {
    this.callback = callback;
    MockResizeObserver.instances.add(this);
  }

  observe() {
    const width = global.__RO_WIDTH__ ?? 1200;
    const height = global.__RO_HEIGHT__ ?? 600;
    this.callback([{ contentRect: { width, height } }]);
  }

  unobserve() {}

  disconnect() {
    MockResizeObserver.instances.delete(this);
  }

  static triggerAll() {
    const width = global.__RO_WIDTH__ ?? 1200;
    const height = global.__RO_HEIGHT__ ?? 600;
    for (const instance of MockResizeObserver.instances) {
      instance.callback([{ contentRect: { width, height } }]);
    }
  }
}

global.ResizeObserver = MockResizeObserver;
global.__triggerResizeObservers = () => MockResizeObserver.triggerAll();

beforeEach(() => {
  global.__RO_WIDTH__ = undefined;
  global.__RO_HEIGHT__ = undefined;
});
