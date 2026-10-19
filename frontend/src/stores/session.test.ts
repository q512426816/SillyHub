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

import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";

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

// ── 乒乓环路切断（2026-10-17-session-replay-pingpong-fix）───────────────────
//
// persist 中间件对每次 setState（含回放）都会写回 localStorage，回放必然再触发
// 对方标签 storage 事件——若同值也回放，两标签各持不同已过期 token 时形成
// A写→B回放→B写→A回放 无限乒乓：accessToken 字符串在 X↔Y 间翻转反复重触发
// (dashboard)/layout.tsx 的 fetchMe effect，而 /api/auth/* 不走 401 自动续期，
// 循环永不自愈（生产实证：/api/auth/me 每秒 10 条 401 刷屏 11 小时）。
// 修复后：回放只回放与本地实际不同的字段，全等时静默（不 setState 即不写盘）。
describe("session storage 同值回放静默（乒乓环路切断）", () => {
  let setItemSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useSession.setState({
      user: USER_A,
      accessToken: "tok-a",
      refreshToken: "rf-a",
      hydrated: true,
    });
    window.localStorage.clear();
    setItemSpy = vi.spyOn(Storage.prototype, "setItem");
  });

  afterEach(() => {
    setItemSpy.mockRestore();
  });

  it("同值回放（user 经 JSON 往返产生新引用）静默跳过：不改状态、不写 localStorage", () => {
    setItemSpy.mockClear();
    // 远端字节与本页状态内容完全一致；JSON.parse 使 user 成为新对象引用，
    // 逐引用比较会误判为变化——这正是被切断的乒乓环路的一条腿。
    fireRemoteWrite(
      persisted({
        accessToken: "tok-a",
        refreshToken: "rf-a",
        user: USER_A,
        hydrated: true,
      }),
    );
    expect(useSession.getState().accessToken).toBe("tok-a");
    expect(useSession.getState().user).toBe(USER_A); // 引用不变：未发生 setState
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("user 内容相同但键序不同（跨端序列化顺序差异）同样静默跳过", () => {
    setItemSpy.mockClear();
    fireRemoteWrite(
      persisted({
        accessToken: "tok-a",
        refreshToken: "rf-a",
        // 键序故意打乱：内容等价，不能因序列化键序差异回写盘
        user: { displayName: "用户A", email: "a@example.com", id: "u-1" },
        hydrated: true,
      }),
    );
    expect(useSession.getState().user).toBe(USER_A);
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("仅 token 变化时只回放 token（本页 user 对象引用保持不动）", () => {
    fireRemoteWrite(
      persisted({
        accessToken: "tok-b",
        refreshToken: "rf-a",
        user: USER_A,
        hydrated: true,
      }),
    );
    expect(useSession.getState().accessToken).toBe("tok-b");
    expect(useSession.getState().refreshToken).toBe("rf-a");
    expect(useSession.getState().user).toBe(USER_A);
  });
});

// ── 信封 rev 防乱序（2026-10-17-session-envelope-rev-stale-guard）───────────
//
// 回放无版本概念时，迟到的旧信封（内容基于已过时的本页状态）仍会覆盖较新本地
// 值——已登出/已续票的标签页可能被幽灵复活（评审 P3-3）。单调 rev：用户驱动的
// 三个变更加一，回放只采纳远端 rev；rev 更旧的信封整体忽略。
describe("session 信封 rev 防乱序（陈旧忽略/采纳）", () => {
  let setItemSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useSession.setState({
      user: USER_A,
      accessToken: "tok-a",
      refreshToken: "rf-a",
      rev: 3,
      hydrated: true,
    });
    window.localStorage.clear();
    setItemSpy = vi.spyOn(Storage.prototype, "setItem");
  });

  afterEach(() => {
    setItemSpy.mockRestore();
  });

  it("陈旧信封（rev 小于本地）整体忽略：内容不同也不采纳、不写盘", () => {
    fireRemoteWrite(
      persisted({
        accessToken: "tok-x",
        refreshToken: "rf-x",
        user: USER_A,
        hydrated: true,
        rev: 2,
      }),
    );
    expect(useSession.getState().accessToken).toBe("tok-a");
    expect(useSession.getState().refreshToken).toBe("rf-a");
    expect(useSession.getState().rev).toBe(3);
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("新 rev 信封采纳：内容同步且 rev 跟随远端（回放不自行加一）", () => {
    fireRemoteWrite(
      persisted({
        accessToken: "tok-b",
        refreshToken: "rf-b",
        user: USER_A,
        hydrated: true,
        rev: 7,
      }),
    );
    expect(useSession.getState().accessToken).toBe("tok-b");
    expect(useSession.getState().rev).toBe(7);
  });

  it("内容全等但 rev 更新 → 仅同步 rev（内容引用不动）", () => {
    fireRemoteWrite(
      persisted({
        accessToken: "tok-a",
        refreshToken: "rf-a",
        user: USER_A,
        hydrated: true,
        rev: 9,
      }),
    );
    expect(useSession.getState().accessToken).toBe("tok-a");
    expect(useSession.getState().user).toBe(USER_A);
    expect(useSession.getState().rev).toBe(9);
  });

  it("等 rev + 同内容 → 静默不写盘（乒乓切断语义在 rev 层仍成立）", () => {
    setItemSpy.mockClear();
    fireRemoteWrite(
      persisted({
        accessToken: "tok-a",
        refreshToken: "rf-a",
        user: USER_A,
        hydrated: true,
        rev: 3,
      }),
    );
    expect(useSession.getState().rev).toBe(3);
    expect(useSession.getState().user).toBe(USER_A);
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("等 rev + 不同内容 → 采纳远端（并发写冲突以后到为准）", () => {
    fireRemoteWrite(
      persisted({
        accessToken: "tok-b",
        refreshToken: "rf-a",
        user: USER_A,
        hydrated: true,
        rev: 3,
      }),
    );
    expect(useSession.getState().accessToken).toBe("tok-b");
    expect(useSession.getState().rev).toBe(3);
  });

  it("无 rev 旧形状信封 → 走既有内容比对路径（向后兼容）", () => {
    fireRemoteWrite(
      persisted({
        accessToken: "tok-legacy",
        refreshToken: "rf-legacy",
        user: USER_A,
        hydrated: true,
      }),
    );
    expect(useSession.getState().accessToken).toBe("tok-legacy");
    expect(useSession.getState().rev).toBe(3); // 旧信封不动本地 rev
  });

  it("用户驱动变更加一：setTokens/clear 各 +1，markHydrated 不加", () => {
    const before = useSession.getState().rev;
    useSession.getState().setTokens({ accessToken: "n1", refreshToken: "n2" });
    expect(useSession.getState().rev).toBe(before + 1);
    useSession.getState().markHydrated();
    expect(useSession.getState().rev).toBe(before + 1);
    useSession.getState().clear();
    expect(useSession.getState().accessToken).toBeNull();
    expect(useSession.getState().rev).toBe(before + 2);
  });
});
