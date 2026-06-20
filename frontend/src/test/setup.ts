import "@testing-library/jest-dom/vitest";

// localStorage polyfill: vitest jsdom + Node 22 实验性 localStorage 不可用,
// daemon/admin 等测试经 zustand persist 依赖 localStorage,补 mock。
if (!globalThis.localStorage) {
  const store: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      Object.keys(store).forEach((k) => delete store[k]);
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  } as any;
}
