/**
 * useSessionLiveness 单测（2026-09-08-session-list-liveness-dot task-03 /
 * FR-01 / FR-03 / D-001@v2 / D-003@v1）。
 *
 * 依据：
 *   - hooks/use-session-liveness.ts（task-01 实现：固定 all 槽 30s 轮询 +
 *     map DESC 首胜 + 客户端转移检测状态机）；
 *   - tasks/task-03.md acceptance：map 构建首个胜出 / queryKey 固定 all 槽 /
 *     转移各边（working→idle 亮、blocked→idle 亮、unknown→idle 不亮、首见不
 *     亮）/ 存储异常降级不崩；
 *   - use-scheduled-messages.test.ts 既有 hook 测试模式（vi.mock 数据源模块 +
 *     renderHook + QueryClientProvider wrapper 经 createElement 包，.ts 免 JSX）。
 *
 * localStorage 用真实 jsdom localStorage 造数（转移 prevState 种子/未读断言），
 * beforeEach 清 sillyhub:liveness-* 键隔离跨用例。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

import {
  SESSION_LIVENESS_QUERY_KEY,
  buildLivenessBySessionId,
  clearUnread,
  isUnread,
  useSessionLiveness,
} from "@/hooks/use-session-liveness";
import type { AgentLogListItem } from "@/lib/agent-logs";

const mocks = vi.hoisted(() => ({
  listWorkspaceAgentLogs: vi.fn(),
}));

vi.mock("@/lib/agent-logs", () => ({
  listWorkspaceAgentLogs: (...args: unknown[]) =>
    mocks.listWorkspaceAgentLogs(...args),
}));

// ── 固件与助手 ───────────────────────────────────────────────────────────

function makeLivenessEntry(
  overrides: Partial<AgentLogListItem> = {},
): AgentLogListItem {
  return {
    id: "log-1",
    workspace_id: "ws-1",
    log_path: "C:/logs/agent.jsonl",
    harness: "zcode",
    exists: true,
    agent_session_id: "sess-1",
    state: "working",
    state_derived_at: "2026-09-07T23:59:50Z",
    state_evidence: "tool_use 未配对 ×2",
    last_event_at: "2026-09-07T23:59:00Z",
    created_at: "2026-09-07T23:00:00Z",
    updated_at: "2026-09-08T00:00:00Z",
    ...overrides,
  } as AgentLogListItem;
}

/** 独立 QueryClient wrapper（retry/gcTime 关，照 use-scheduled-messages 先例）。 */
function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { wrapper, client };
}

const STATE_KEY = (id: string) => `sillyhub:liveness-state:${id}`;
const UNREAD_KEY = (id: string) => `sillyhub:liveness-unread:${id}`;

/** 清 liveness 两族 localStorage 键（跨用例隔离）。 */
function clearLivenessStorage() {
  for (const key of Object.keys(window.localStorage)) {
    if (
      key.startsWith("sillyhub:liveness-state:") ||
      key.startsWith("sillyhub:liveness-unread:")
    ) {
      window.localStorage.removeItem(key);
    }
  }
}

beforeEach(() => {
  mocks.listWorkspaceAgentLogs.mockReset().mockResolvedValue({ items: [] });
  clearLivenessStorage();
});

// ── map 构建（DESC 首个胜出） ────────────────────────────────────────────

describe("useSessionLiveness map 构建", () => {
  it("同 agent_session_id 首（最新）胜出，后到不覆盖；无值条目剔除", () => {
    const map = buildLivenessBySessionId([
      makeLivenessEntry({ id: "log-new", agent_session_id: "sess-1", state: "idle" }),
      makeLivenessEntry({ id: "log-old", agent_session_id: "sess-1", state: "working" }),
      makeLivenessEntry({ id: "log-null", agent_session_id: null }),
      makeLivenessEntry({ id: "log-2", agent_session_id: "sess-2", state: "blocked" }),
    ]);
    expect(map.size).toBe(2);
    expect(map.get("sess-1")?.id).toBe("log-new");
    expect(map.get("sess-1")?.state).toBe("idle");
    expect(map.get("sess-2")?.id).toBe("log-2");
  });

  it("hook 挂载后 bySessionId/entries 按响应构建", async () => {
    mocks.listWorkspaceAgentLogs.mockResolvedValue({
      items: [
        makeLivenessEntry({ id: "log-a", agent_session_id: "sess-1" }),
        makeLivenessEntry({ id: "log-b", agent_session_id: "sess-2", state: "idle" }),
      ],
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSessionLiveness(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.entries.length).toBe(2);
    expect(result.current.bySessionId.get("sess-2")?.state).toBe("idle");
  });
});

// ── queryKey 固定 all 槽（D-001@v2 / Grill CC-01） ────────────────────────

describe("useSessionLiveness queryKey 固定 all 槽", () => {
  it("key 常量与实际注册查询槽均为 [agent-liveness-overview, all]，limit=100", async () => {
    expect(SESSION_LIVENESS_QUERY_KEY).toEqual([
      "agent-liveness-overview",
      "all",
    ]);
    mocks.listWorkspaceAgentLogs.mockResolvedValue({
      items: [makeLivenessEntry()],
    });
    const { wrapper, client } = makeWrapper();
    const { result } = renderHook(() => useSessionLiveness(), { wrapper });
    await waitFor(() => expect(result.current.bySessionId.size).toBe(1));

    const cacheKeys = client
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey);
    // 固定 all 槽注册（多挂载共享缓存）；不产生 wsId 槽（与总览卡各自独立）。
    expect(cacheKeys).toContainEqual(["agent-liveness-overview", "all"]);
    expect(cacheKeys).not.toContainEqual(["agent-liveness-overview", "ws-1"]);
    expect(mocks.listWorkspaceAgentLogs).toHaveBeenCalledWith(100);
  });
});

// ── 转移检测状态机（D-001@v2：仅比较 prevState 与 current 的 state 值） ────

describe("useSessionLiveness 转移检测状态机", () => {
  /** 种 prevState 后挂载 hook 并等到数据到位。 */
  async function mountWithState(
    prevState: string | null,
    current: AgentLogListItem["state"],
  ) {
    if (prevState !== null) {
      window.localStorage.setItem(STATE_KEY("sess-1"), prevState);
    }
    mocks.listWorkspaceAgentLogs.mockResolvedValue({
      items: [makeLivenessEntry({ agent_session_id: "sess-1", state: current })],
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSessionLiveness(), { wrapper });
    await waitFor(() => expect(result.current.bySessionId.size).toBe(1));
    // effect 落盘后再断言（state 键更新到位 = 状态机跑完）。
    await waitFor(() =>
      expect(window.localStorage.getItem(STATE_KEY("sess-1"))).toBe(current),
    );
    return result;
  }

  it("working→idle：写未读标记（红点来源）", async () => {
    await mountWithState("working", "idle");
    expect(window.localStorage.getItem(UNREAD_KEY("sess-1"))).not.toBeNull();
    expect(isUnread("sess-1")).toBe(true);
  });

  it("blocked→idle：同写未读标记", async () => {
    await mountWithState("blocked", "idle");
    expect(isUnread("sess-1")).toBe(true);
  });

  it("unknown→idle：不写未读（仅 working/blocked 是来源态）", async () => {
    await mountWithState("unknown", "idle");
    expect(window.localStorage.getItem(UNREAD_KEY("sess-1"))).toBeNull();
    expect(isUnread("sess-1")).toBe(false);
  });

  it("首见（无 prevState）→idle：不写未读，仅落 state 键", async () => {
    await mountWithState(null, "idle");
    expect(window.localStorage.getItem(UNREAD_KEY("sess-1"))).toBeNull();
    expect(isUnread("sess-1")).toBe(false);
  });

  it("working→ended（非 idle 目标态）：不写未读，state 键照常更新", async () => {
    await mountWithState("working", "ended");
    expect(window.localStorage.getItem(UNREAD_KEY("sess-1"))).toBeNull();
    expect(window.localStorage.getItem(STATE_KEY("sess-1"))).toBe("ended");
  });
});

// ── 未读 helper（isUnread / clearUnread） ────────────────────────────────

describe("useSessionLiveness 未读 helper", () => {
  it("isUnread 按 unread 键存在性判定；clearUnread 删除标记", () => {
    expect(isUnread("sess-x")).toBe(false);
    window.localStorage.setItem(UNREAD_KEY("sess-x"), String(Date.now()));
    expect(isUnread("sess-x")).toBe(true);
    clearUnread("sess-x");
    expect(isUnread("sess-x")).toBe(false);
    expect(window.localStorage.getItem(UNREAD_KEY("sess-x"))).toBeNull();
  });
});

// ── 存储异常降级（localStorage 不可用不崩、不亮红点） ─────────────────────

describe("useSessionLiveness 存储异常降级", () => {
  // jsdom 的 localStorage 是 Proxy（实例级 spyOn 拦不到转发后的底层方法），
  // 降级注入点打在 Storage.prototype 上。
  it("setItem 抛错：转移检测停摆（不写未读）但 hook 正常返回数据不崩", async () => {
    window.localStorage.setItem(STATE_KEY("sess-1"), "working");
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    mocks.listWorkspaceAgentLogs.mockResolvedValue({
      items: [makeLivenessEntry({ agent_session_id: "sess-1", state: "idle" })],
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSessionLiveness(), { wrapper });
    await waitFor(() => expect(result.current.bySessionId.size).toBe(1));
    expect(result.current.bySessionId.get("sess-1")?.state).toBe("idle");
    // 写不进 → 未读不亮，且渲染/取数无异常抛出。
    expect(window.localStorage.getItem(UNREAD_KEY("sess-1"))).toBeNull();
    setItemSpy.mockRestore();
  });

  it("getItem 抛错：isUnread 恒 false（fail-open 不误亮）", () => {
    // 先种真实未读键，证伪「读不到键所以 false」——抛错路径也必须收敛 false。
    window.localStorage.setItem(UNREAD_KEY("sess-y"), String(Date.now()));
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    expect(isUnread("sess-y")).toBe(false);
    getItemSpy.mockRestore();
  });
});
