// 2026-10-22-session-trajectory-third-view（D-001）：视图模式按会话持久化三态。
//
// 锁定：写入 "trajectory" 后回读仍为 trajectory；旧值 all / conversation 原义；
// 非法值 / 缺失回落 conversation（刷新不把用户扔到错误的视图）。
import { beforeEach, describe, expect, it } from "vitest";

import { readPersistedViewMode, writePersistedViewMode } from "../turn-state";

const KEY = "sillyhub.sessions.viewMode.s-1";

describe("会话视图模式持久化（三态）", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("写入轨迹后回读为 trajectory", () => {
    writePersistedViewMode("s-1", "trajectory");

    expect(window.localStorage.getItem(KEY)).toBe("trajectory");
    expect(readPersistedViewMode("s-1")).toBe("trajectory");
  });

  it("all / conversation 旧值原义", () => {
    window.localStorage.setItem(KEY, "all");
    expect(readPersistedViewMode("s-1")).toBe("all");

    window.localStorage.setItem(KEY, "conversation");
    expect(readPersistedViewMode("s-1")).toBe("conversation");
  });

  it("非法值 / 缺失回落 conversation", () => {
    expect(readPersistedViewMode("s-1")).toBe("conversation");

    window.localStorage.setItem(KEY, "unknown-mode");
    expect(readPersistedViewMode("s-1")).toBe("conversation");
  });

  it("按会话隔离：不同 sessionId 互不影响", () => {
    writePersistedViewMode("s-1", "trajectory");
    writePersistedViewMode("s-2", "all");

    expect(readPersistedViewMode("s-1")).toBe("trajectory");
    expect(readPersistedViewMode("s-2")).toBe("all");
  });
});
