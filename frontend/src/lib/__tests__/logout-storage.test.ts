/**
 * 2026-10-14-logout-localstorage-user-data-cleanup：登出清理 localStorage 用户域键。
 *
 * 契约：clearUserScopedLocalStorage 删光 USER_SCOPED_LS_PREFIXES 命中的键
 * （含预会话草稿变体），设备级键（主题/记住登录名/输入框高度/新建会话默认
 * 机器等）一律保留；前缀带尾分隔符精确匹配（`sillyhub.sessions.new.machineId`
 * 同命名空间但非用户域，不得误删）；单键删除失败不阻断其余键清理。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  USER_SCOPED_LS_PREFIXES,
  clearUserScopedLocalStorage,
} from "@/lib/logout-storage";

/** 设备级键样本（与 design.md 保留面对应，挑代表断言保留）。 */
const DEVICE_KEYS = [
  "sillyhub-theme",
  "multi-agent-platform.session",
  "sillyhub.remember-account",
  "sillyhub.platform",
  "sillyhub.sessions.new.machineId", // 同 sillyhub.sessions.* 命名空间的设备级键
  "sillyhub:session-input-height",
];

/** 用户域键样本（7 前缀全覆盖 + 预会话草稿变体 + 多会话多键）。 */
const USER_KEYS = [
  "sillyhub.sessions.draft.sid-1",
  "sillyhub.sessions.draft.__pre__",
  "sillyhub.sessions.draft.__pre__:runtime-9",
  "sillyhub.sessions.viewMode.sid-1",
  "sillyhub.groupchats.draft.gid-1",
  "sillyhub-group-last-open-gid-1",
  "sillyhub:liveness-state:sid-1",
  "sillyhub:liveness-unread:sid-1",
  "sillyhub:session-completed-unread:sid-1",
];

beforeEach(() => {
  window.localStorage.clear();
  for (const key of [...DEVICE_KEYS, ...USER_KEYS]) {
    window.localStorage.setItem(key, "x");
  }
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("clearUserScopedLocalStorage（2026-10-14-logout-localstorage-user-data-cleanup）", () => {
  it("7 类用户域前缀全清、设备级键保留、前缀精确匹配", () => {
    clearUserScopedLocalStorage();

    for (const key of USER_KEYS) {
      expect(window.localStorage.getItem(key), key).toBeNull();
    }
    for (const key of DEVICE_KEYS) {
      expect(window.localStorage.getItem(key), key).toBe("x");
    }
  });

  it("注册表前缀全部带尾分隔符（同命名空间近邻键不被宽匹配误删）", () => {
    for (const prefix of USER_SCOPED_LS_PREFIXES) {
      expect(prefix.endsWith(".") || prefix.endsWith("-") || prefix.endsWith(":")).toBe(
        true,
      );
    }
  });

  it("removeItem 抛错时容错继续清理其余键（不阻断登出）", () => {
    // jsdom 的 Storage 方法 unforgeable（vi.spyOn 拦不住，探针实证 calls 为空仍删键）——
    // 与 app-shell 测试的 window.location 同款：defineProperty 整体替换，finally 还原。
    const originalLsDesc = Object.getOwnPropertyDescriptor(window, "localStorage");
    const realLs = window.localStorage;
    const throwingLs: Storage = {
      get length() {
        return realLs.length;
      },
      key: (index: number) => realLs.key(index),
      getItem: (key: string) => realLs.getItem(key),
      setItem: (key: string, value: string) => realLs.setItem(key, value),
      removeItem: (key: string) => {
        if (key === "sillyhub.sessions.draft.sid-1") throw new Error("quota");
        realLs.removeItem(key);
      },
      clear: () => realLs.clear(),
    };
    Object.defineProperty(window, "localStorage", {
      value: throwingLs,
      configurable: true,
    });
    try {
      expect(() => clearUserScopedLocalStorage()).not.toThrow();
      // 抛错键残留（容错面），其余用户域键仍被清
      expect(realLs.getItem("sillyhub.sessions.draft.sid-1")).toBe("x");
      expect(realLs.getItem("sillyhub.groupchats.draft.gid-1")).toBeNull();
      // 设备级键不受影响
      expect(realLs.getItem("sillyhub-theme")).toBe("x");
    } finally {
      if (originalLsDesc) {
        Object.defineProperty(window, "localStorage", originalLsDesc);
      }
    }
  });

  it("空 localStorage / 无匹配键时安全空转", () => {
    window.localStorage.clear();
    expect(() => clearUserScopedLocalStorage()).not.toThrow();
  });
});
