// tests/stores/session.test.ts
// 跨标签页同步（storage 事件回放）单测。
//
// 背景（多标签页登录态互踢根因）：
//   - token 经 zustand persist 写 localStorage，多标签页共享存储但内存副本
//     互不同步；A 页续票轮换 refresh token 后，B 页持旧 token 续票超过后端
//     60s 复用宽限窗 → 判重放攻击 → 吊销全部会话 → 全部标签页被踢回登录页。
//   - 修复：session store 模块级监听 storage 事件，其它标签页写入即回放进
//     本页内存（见 stores/session.ts 数据流边界注释）。
//
// 覆盖：
//   1. 其它标签页写入新 token 对 → 本页 accessToken/refreshToken 同步
//   2. 其它标签页登出（字段全 null）→ 本页同步清空（跨页登出）
//   3. 其它标签页换账号重新登录 → user 同步
//   4. 非本 key 的事件 / newValue=null（removeItem）/ 坏 JSON → 本页状态不动
//   5. 旧形状缺字段 → 只回放存在的字段，不误清
//   6. hydrated 为本页生命周期标记，不被远端回放改写

import { describe, it, expect, beforeEach } from "vitest";

import {
  useSession,
  SESSION_STORAGE_KEY,
  type SessionUser,
} from "@/stores/session";

const USER_A: SessionUser = {
  id: "u-1",
  email: "a@example.com",
  displayName: "用户A",
};

const USER_B: SessionUser = {
  id: "u-2",
  email: "b@example.com",
  displayName: "用户B",
};

/** 模拟「其它标签页 persist 写入」触发的 storage 事件（storage 事件仅在写入方以外的页面触发）。 */
function fireRemoteWrite(value: string | null, key: string = SESSION_STORAGE_KEY) {
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
}

/** 按 zustand persist 落盘形状构造 JSON（{ state, version }）。 */
function persisted(state: Record<string, unknown>): string {
  return JSON.stringify({ state, version: 1 });
}

describe("session store 跨标签页同步（storage 事件回放）", () => {
  beforeEach(() => {
    // 每用例重置为本页基线：已登录用户A + 一对旧 token。
    useSession.setState({
      user: USER_A,
      accessToken: "old-access",
      refreshToken: "old-refresh",
      hydrated: true,
    });
    window.localStorage.clear();
  });

  it("其它标签页续票写入新 token 对 → 本页内存同步（不再持旧 refresh 去续票）", () => {
    fireRemoteWrite(
      persisted({
        accessToken: "new-access",
        refreshToken: "new-refresh",
        user: USER_A,
        hydrated: true,
      }),
    );
    expect(useSession.getState().accessToken).toBe("new-access");
    expect(useSession.getState().refreshToken).toBe("new-refresh");
  });

  it("其它标签页登出（字段全 null）→ 本页同步清空", () => {
    fireRemoteWrite(
      persisted({ accessToken: null, refreshToken: null, user: null, hydrated: true }),
    );
    expect(useSession.getState().accessToken).toBeNull();
    expect(useSession.getState().refreshToken).toBeNull();
    expect(useSession.getState().user).toBeNull();
  });

  it("其它标签页换账号登录 → user 随 token 对一起同步", () => {
    fireRemoteWrite(
      persisted({
        accessToken: "b-access",
        refreshToken: "b-refresh",
        user: USER_B,
        hydrated: true,
      }),
    );
    expect(useSession.getState().user).toEqual(USER_B);
    expect(useSession.getState().accessToken).toBe("b-access");
  });

  it("非本 key / removeItem(null) / 坏 JSON / 缺 state 字段 → 本页状态不动", () => {
    fireRemoteWrite(
      persisted({ accessToken: "x", refreshToken: "y", user: USER_B }),
      "some-other-key",
    );
    fireRemoteWrite(null);
    fireRemoteWrite("{not-json");
    fireRemoteWrite(JSON.stringify({ version: 1 }));
    expect(useSession.getState().accessToken).toBe("old-access");
    expect(useSession.getState().refreshToken).toBe("old-refresh");
    expect(useSession.getState().user).toEqual(USER_A);
  });

  it("旧形状缺字段 → 只回放存在的字段，不误清缺省字段", () => {
    fireRemoteWrite(persisted({ accessToken: "partial-access" }));
    expect(useSession.getState().accessToken).toBe("partial-access");
    // refreshToken/user 未在远端形状中出现，保持本页原值。
    expect(useSession.getState().refreshToken).toBe("old-refresh");
    expect(useSession.getState().user).toEqual(USER_A);
  });

  it("hydrated 为本页生命周期标记 → 远端回放不将其改写为 false", () => {
    fireRemoteWrite(
      persisted({
        accessToken: "new-access",
        refreshToken: "new-refresh",
        user: USER_A,
        hydrated: false,
      }),
    );
    expect(useSession.getState().hydrated).toBe(true);
  });
});
