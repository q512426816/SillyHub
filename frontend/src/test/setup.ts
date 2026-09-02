import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// CI 满载并发（128 测试文件）下 jsdom 渲染+异步 state 更新偏慢，`findBy*`/`waitFor`
// 默认 1s 等待在部分用例偶发超时（ImportModuleModal ④/⑤ 曾连续 flake）。
// 全局提到 5s：合法等待更宽容，不掩盖逻辑错误（通过仍毫秒级）。
configure({ asyncUtilTimeout: 5000 });

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

// matchMedia polyfill: antd 响应式组件 (Modal/TreeSelect/Select 等) 在 jsdom 需要。
if (!globalThis.matchMedia) {
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}

// ResizeObserver polyfill: antd Drawer 等组件在 jsdom 需要 (与 matchMedia 同类)。
if (!globalThis.ResizeObserver) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver,
  });
}

// URL.createObjectURL polyfill: jsdom 未实现（FileImage / GroupMemberAvatar 等
// blob 图片渲染链路需要——fetchFileBlob → objectURL → <img>；revoke 配套补齐）。
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () =>
    `blob:mock-${Math.random().toString(36).slice(2)}`;
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => {};
}
