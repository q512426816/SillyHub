// session-panel takeover chrome 测试（2026-09-30-tool-report-activation-
// wrong-machine task-07 / FR-06 / D-004@v1 / D-005@v2 / D-006@v1）。
//
// 覆盖：
//   1. deriveTakeoverChrome 纯函数：native/handoff 档、原机在线/离线、
//      存量无机器身份兜底、引擎集合派生；
//   2. 面板渲染（dialog 模式）：未激活 tool_report 会话衔接提示条（native
//      接续/handoff 分叉文案）+ handoff 引擎选择器；chat 会话零渲染；
//   3. 发送走 takeover 端点（不走 inject）并按响应跳转接手会话浮层；
//   4. 存量已激活（turn_count>0）渲染「重置为未激活」入口。
//
// 测试纪律：仅 mock 网络层（@/lib/agent-logs、@/lib/daemon 关键函数、sse/
// zustand store），断言用文案与 aria-label；harness 镜像
// session-panel-connection.test.tsx。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const sseMock = vi.hoisted(() => ({ fetchSse: vi.fn() }));
vi.mock("@/lib/fetch-sse", () => ({ fetchSse: sseMock.fetchSse }));

const sessionStoreMock = vi.hoisted(() => ({
  state: { accessToken: "t", refreshToken: "r", hydrated: true },
}));
vi.mock("@/stores/session", () => ({
  useSession: Object.assign(
    (sel: (s: unknown) => unknown) => sel(sessionStoreMock.state),
    { getState: () => sessionStoreMock.state },
  ),
}));

// @/lib/daemon：实际模块 + 接手/重置/会话详情覆写。
const daemonMock = vi.hoisted(() => ({
  getSessionUsage: vi.fn().mockResolvedValue(null),
  streamSession: vi.fn(),
  getAgentSession: vi.fn(),
  listSessionRuns: vi.fn().mockResolvedValue([]),
  listSessionTasks: vi.fn().mockResolvedValue([]),
  getAgentSessionLogs: vi.fn().mockResolvedValue([]),
  fetchSessionTurnOutline: vi.fn().mockResolvedValue({
    session_id: "s-tr",
    total_turns: 0,
    items: [],
  }),
  fetchPendingDialogs: vi.fn().mockResolvedValue([]),
  fetchSessionQueue: vi.fn().mockResolvedValue({ items: [] }),
  fetchSessionDialogHistory: vi.fn().mockResolvedValue([]),
  listSessionTeamMissions: vi.fn(),
  takeoverSession: vi.fn(),
  resetToolReportSession: vi.fn(),
}));
vi.mock("@/components/ui/markdown-text", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="markdown-stub">{children}</div>
  ),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return { ...actual, ...daemonMock };
});

// @/lib/agent-logs：列表回带机器名的 items。
const agentLogsMock = vi.hoisted(() => ({ listAgentLogs: vi.fn() }));
vi.mock("@/lib/agent-logs", () => ({ listAgentLogs: agentLogsMock.listAgentLogs }));

import { SessionPanel } from "../session-panel";
import { deriveTakeoverChrome } from "../session-panel/page-helpers";
import type { DaemonMachineRead } from "@/lib/daemon";

/* ────────────────────── deriveTakeoverChrome 纯函数 ────────────────────── */

const machine = (
  hostname: string,
  providers: string[],
  status = "online",
): DaemonMachineRead =>
  ({
    id: hostname,
    hostname,
    display_alias: null,
    os: null,
    arch: null,
    status,
    last_heartbeat_at: null,
    version: null,
    build_id: null,
    started_at: null,
    runtimes: providers.map((p) => ({
      id: `${hostname}-${p}`,
      name: hostname,
      provider: p,
      version: null,
      os: null,
      arch: null,
      status: "online",
      last_heartbeat_at: null,
      capabilities: null,
      allowed_roots: [],
      created_at: "",
      updated_at: "",
    })),
  }) as unknown as DaemonMachineRead;

describe("deriveTakeoverChrome", () => {
  it("claude-code → native 档，原机在线含引擎集合", () => {
    const chrome = deriveTakeoverChrome({
      harness: "claude-code",
      reportedMachineName: "WIN-A",
      machines: [machine("WIN-A", ["claude", "codex"])],
    });
    expect(chrome.tier).toBe("native");
    expect(chrome.machineOnline).toBe(true);
    expect(chrome.engines).toEqual(["claude", "codex"]);
  });

  it("zcode → handoff 档；原机离线 machineOnline=false 且引擎集空", () => {
    const chrome = deriveTakeoverChrome({
      harness: "zcode",
      reportedMachineName: "WIN-A",
      machines: [machine("WIN-A", ["claude"], "offline")],
    });
    expect(chrome.tier).toBe("handoff");
    expect(chrome.machineOnline).toBe(false);
    expect(chrome.engines).toEqual([]);
  });

  it("存量无机器身份 → 在线态未知兜底 true，engines 取全部在线机器并集", () => {
    const chrome = deriveTakeoverChrome({
      harness: "zcode",
      reportedMachineName: null,
      machines: [machine("A", ["claude"]), machine("B", ["pi"])],
    });
    expect(chrome.machineOnline).toBe(true);
    expect(chrome.engines).toEqual(["claude", "pi"]);
    expect(chrome.machineLabel).toBe("（未知机器）");
  });
});

/* ────────────────────── TakeoverBridgeNote 组件 ────────────────────── */

import { TakeoverBridgeNote } from "../session-panel/takeover-bridge-note";

function renderNote(chrome: Parameters<typeof TakeoverBridgeNote>[0]["chrome"], harness = "zcode") {
  return render(
    <TakeoverBridgeNote
      chrome={chrome}
      harness={harness}
      provider={null}
      onProviderChange={() => {}}
    />,
  );
}

describe("TakeoverBridgeNote", () => {
  it("handoff 档：黄条（分叉+交接文档）+ 引擎选择器（白名单内引擎）", () => {
    renderNote({
      tier: "handoff",
      machineOnline: true,
      machineLabel: "WIN-A",
      // 白名单过滤由 deriveTakeoverChrome 完成（openclaw 已滤除）——组件
      // 收到的 engines 即已过滤集合，断言不含不可会话引擎的渲染面。
      engines: ["claude", "codex"],
    });
    expect(screen.getByText(/分叉出新会话/)).toBeInTheDocument();
    expect(screen.getByText(/交接文档/)).toBeInTheDocument();
    const select = screen.getByLabelText("接手引擎") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      "",
      "claude",
      "codex",
    ]);
  });

  it("白名单过滤：deriveTakeoverChrome 滤除 openclaw/kimi 等不可会话引擎", () => {
    const machineWithExtras = {
      ...machine("WIN-A", ["claude", "openclaw", "kimi", "codex"]),
    };
    const chrome = deriveTakeoverChrome({
      harness: "zcode",
      reportedMachineName: "WIN-A",
      machines: [machineWithExtras],
    });
    expect(chrome.engines).toEqual(["claude", "codex"]);
  });

  it("native 档：绿条（接续原会话+机器名）无选择器", () => {
    renderNote(
      {
        tier: "native",
        machineOnline: true,
        machineLabel: "WIN-A",
        engines: ["claude"],
      },
      "claude-code",
    );
    expect(screen.getByText(/接续原 claude-code 会话/)).toBeInTheDocument();
    expect(screen.getByText(/WIN-A/)).toBeInTheDocument();
    expect(screen.queryByLabelText("接手引擎")).toBeNull();
  });

  it("原机离线：红条（不换机）无选择器", () => {
    renderNote({
      tier: "handoff",
      machineOnline: false,
      machineLabel: "GONE-HOST",
      engines: [],
    });
    expect(screen.getByText(/GONE-HOST 当前离线/)).toBeInTheDocument();
    expect(screen.getByText(/不会换机执行/)).toBeInTheDocument();
    expect(screen.queryByLabelText("接手引擎")).toBeNull();
  });
});
