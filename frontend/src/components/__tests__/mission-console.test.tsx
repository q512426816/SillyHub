// tests/components/__tests__/mission-console.test.tsx
// task-10 重写（2026-07-14-missions-page-redesign）：对齐重设计后的组件。
//
// 依据：
//   - plan.md task-01/02/03/04/05/06/07/08/09/10 + design.md §4/5/6/7
//   - decisions.md D-001~008@v1（固定 team / 高级默认折叠 / 总览卡+AI结论 / 藏黑话 / 折叠）
//
// 覆盖：
//   - 固定 team：无 single/team 选择卡片；启动按钮文案「启动」
//   - 高级默认折叠（details open=false）；展开后主控配置+分身列表可见，添加分身生效
//   - submit 固定 mode="team" + main_agent_config(默认) + worker_preset(默认[])
//   - 详情总览卡：中文状态（不露英文 status）+ 成败统计（排除主控）+ AI 最终结论(summary)
//   - 分工目标默认折叠（全文不直接露出）
//   - 藏黑话：UI 不出现 Coordinator/Worker/daemon 英文术语

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import type { AgentRunLogEntry, Mission } from "@/lib/agent";
import { mergeLogsById } from "@/components/mission-console";

const hoisted = vi.hoisted(() => {
  return {
    createMissionMock: vi.fn() as unknown as ReturnType<typeof vi.fn>,
    getAgentRunLogsMock: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  };
});

vi.mock("@/lib/agent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent")>("@/lib/agent");
  return {
    ...actual,
    createMission: hoisted.createMissionMock,
    getAgentRunLogs: hoisted.getAgentRunLogsMock,
  };
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: () => {} }),
}));

// MarkdownText 用 next/dynamic + ssr:false，jsdom 里同步 render 处于 loading(null)
// （与 agent-log-viewer.test.tsx 同因）——mock 成纯文本渲染，让 WorkerLogPanel 的
// 日志行内容可断言（本文件测增量合并/去重/fallback，不测 markdown 渲染本身）。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

import { MissionConsole } from "@/components/mission-console";

const FAKE_MISSION: Mission = {
  id: "miss-1",
  workspace_id: "ws-1",
  change_id: null,
  objective: "test",
  status: "planning",
  budget_usd: null,
  cost_so_far: 0,
  constraints: null,
  cancelled_at: null,
  created_at: "2026-07-12T00:00:00Z",
  workers: [],
};

function mockCreateResolve(m: Mission = FAKE_MISSION) {
  hoisted.createMissionMock.mockResolvedValue(m);
}

/** 工具：拿到「高级」details 的 open 状态。 */
function advancedDetailsOpen(): boolean {
  const summary = screen.queryByText(/高级：手动配分身/);
  const details = summary?.closest("details") ?? null;
  return details?.open ?? false;
}

describe("MissionConsole 重设计（2026-07-14-missions-page-redesign）", () => {
  beforeEach(() => {
    cleanup();
    hoisted.createMissionMock.mockReset();
    mockCreateResolve();
  });
  it("固定 team：无 single/team 选择卡片，启动按钮文案「启动」", () => {
    render(<MissionConsole workspaceId="ws-1" />);
    expect(screen.queryByRole("button", { name: "模式 team" })).toBeNull();
    expect(screen.queryByRole("button", { name: "模式 single" })).toBeNull();
    expect(screen.getByRole("button", { name: "启动" })).toBeTruthy();
  });

  it("输入框 placeholder 为人话（无代码路径）", () => {
    render(<MissionConsole workspaceId="ws-1" />);
    const ta = screen.getByPlaceholderText(/描述你要 AI 团队做什么/);
    expect(ta).toBeTruthy();
  });

  it("高级默认折叠：details open=false", () => {
    render(<MissionConsole workspaceId="ws-1" />);
    expect(advancedDetailsOpen()).toBe(false);
  });

  it("展开高级后：主控配置+分身列表可见，添加分身增加一行", () => {
    render(<MissionConsole workspaceId="ws-1" />);
    fireEvent.click(screen.getByText(/高级：手动配分身/));
    expect(advancedDetailsOpen()).toBe(true);
    expect(screen.getByLabelText("主控 AI 类型")).toBeTruthy();
    expect(screen.getByLabelText("主控模型")).toBeTruthy();
    // 初始 0 条分身（默认主控自动拆）
    expect(screen.getByText(/分身列表（0）/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /添加分身/ }));
    expect(screen.getByText(/分身列表（1）/)).toBeTruthy();
    expect(screen.getByLabelText("分身 1 分工目标")).toBeTruthy();
  });

  it("submit：固定 mode=team + main_agent_config(默认) + worker_preset(默认空数组)", async () => {
    render(<MissionConsole workspaceId="ws-1" />);
    fireEvent.change(screen.getByPlaceholderText(/描述你要/), {
      target: { value: "扫描架构" },
    });
    fireEvent.click(screen.getByRole("button", { name: "启动" }));

    await waitFor(() => {
      expect(hoisted.createMissionMock).toHaveBeenCalledTimes(1);
    });
    const [, payload] = hoisted.createMissionMock.mock.calls[0] as [
      string,
      unknown,
    ];
    const p = payload as Record<string, unknown>;
    expect(p.mode).toBe("team");
    expect(p.main_agent_config).toEqual({
      agent_type: "claude_code",
      provider: "claude",
      model: "claude-sonnet-4-6",
    });
    expect(Array.isArray(p.worker_preset)).toBe(true);
    expect((p.worker_preset as unknown[]).length).toBe(0);
  });

  it("详情总览卡：中文状态 + 成败统计(排除主控) + AI 最终结论", async () => {
    const missionDegraded: Mission = {
      ...FAKE_MISSION,
      status: "degraded",
      cost_so_far: 0.4712,
      budget_usd: null,
      workers: [
        {
          id: "main-1",
          role: "orchestrator",
          objective: "主控调度",
          status: "completed",
          total_cost_usd: 0.1,
          started_at: null,
          finished_at: null,
          artifacts: [],
        },
        {
          id: "w-1",
          role: "arch",
          objective: "架构分析（长指令原文示例）",
          status: "completed",
          total_cost_usd: 0.2,
          started_at: null,
          finished_at: null,
          artifacts: [
            {
              id: "art-summary",
              kind: "summary",
              content_ref: "本次分析了会话上下文架构。",
              created_at: "2026-07-12T00:00:00Z",
            },
          ],
        },
        {
          id: "w-2",
          role: "verify",
          objective: "核查",
          status: "failed",
          total_cost_usd: 0.17,
          started_at: null,
          finished_at: null,
          artifacts: [],
        },
      ],
    };
    mockCreateResolve(missionDegraded);
    render(<MissionConsole workspaceId="ws-1" />);
    fireEvent.change(screen.getByPlaceholderText(/描述你要/), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "启动" }));
    await waitFor(() => {
      expect(hoisted.createMissionMock).toHaveBeenCalledTimes(1);
    });
    // 中文状态（部分完成），英文 degraded 不露出
    expect(screen.getByText("部分完成")).toBeTruthy();
    expect(screen.queryByText("degraded")).toBeNull();
    // 成败统计：2 个真分身（排除主控），成功 1
    expect(screen.getByText(/2 个分身/)).toBeTruthy();
    // AI 最终结论（summary artifact content_ref）
    expect(screen.getByText("本次分析了会话上下文架构。")).toBeTruthy();
  });

  it("分工目标默认折叠：worker objective 全文不直接露出", async () => {
    const m: Mission = {
      ...FAKE_MISSION,
      status: "running",
      workers: [
        {
          id: "w-1",
          role: "arch",
          objective: "超长分工指令原文不应该默认露出",
          status: "running",
          total_cost_usd: null,
          started_at: null,
          finished_at: null,
          artifacts: [],
        },
      ],
    };
    mockCreateResolve(m);
    render(<MissionConsole workspaceId="ws-1" />);
    fireEvent.change(screen.getByPlaceholderText(/描述你要/), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "启动" }));
    await waitFor(() =>
      expect(hoisted.createMissionMock).toHaveBeenCalledTimes(1),
    );
    // 折叠触发器可见
    expect(screen.getByText(/分工目标（点开看完整）/)).toBeTruthy();
    // 全文默认不露出（条件渲染，close 时不在 DOM）
    expect(
      screen.queryByText("超长分工指令原文不应该默认露出"),
    ).toBeNull();
  });

  it("藏黑话：UI 不出现 Coordinator/Worker/daemon 英文术语", async () => {
    const m: Mission = {
      ...FAKE_MISSION,
      status: "running",
      workers: [
        {
          id: "w-1",
          role: "arch",
          objective: "x",
          status: "running",
          total_cost_usd: null,
          started_at: null,
          finished_at: null,
          artifacts: [],
        },
      ],
    };
    mockCreateResolve(m);
    render(<MissionConsole workspaceId="ws-1" />);
    fireEvent.change(screen.getByPlaceholderText(/描述你要/), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "启动" }));
    await waitFor(() =>
      expect(hoisted.createMissionMock).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByText(/\bCoordinator\b/)).toBeNull();
    expect(screen.queryByText(/\bWorker\b/)).toBeNull();
    expect(screen.queryByText(/\bdaemon\b/i)).toBeNull();
  });

  it("分身中文角色：详情显示「架构分析」而非 [arch] 方括号代号", async () => {
    const m: Mission = {
      ...FAKE_MISSION,
      status: "running",
      workers: [
        {
          id: "w-1",
          role: "arch",
          objective: "x",
          status: "running",
          total_cost_usd: null,
          started_at: null,
          finished_at: null,
          artifacts: [],
        },
      ],
    };
    mockCreateResolve(m);
    render(<MissionConsole workspaceId="ws-1" />);
    fireEvent.change(screen.getByPlaceholderText(/描述你要/), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "启动" }));
    await waitFor(() =>
      expect(hoisted.createMissionMock).toHaveBeenCalledTimes(1),
    );
    expect(screen.getAllByText("架构分析").length).toBeGreaterThan(0);
    expect(screen.queryByText(/\[arch\]/)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  perf-remediation task-08 / FR-10：WorkerLogPanel 日志增量游标      */
/*  after = 已见最早一条 timestamp；后端返回更新条目；前端按 id 去重    */
/*  合并；游标空结果且本地积压超阈值 → 一次全量重拉兜底。               */
/* ------------------------------------------------------------------ */

function makeLog(id: string, ts: string): AgentRunLogEntry {
  return {
    id,
    run_id: "w-1",
    timestamp: ts,
    channel: "stdout",
    content_redacted: `日志行 ${id}`,
  };
}

describe("mergeLogsById：增量合并按 id 去重并维持正序", () => {
  it("新日志并入且按 timestamp 正序排列", () => {
    const existing = [makeLog("a", "2026-08-15T07:00:01.000Z")];
    // 增量响应（与已见重叠一条 + 新一条），乱序给入
    const incoming = [
      makeLog("c", "2026-08-15T07:00:05.000Z"),
      makeLog("b", "2026-08-15T07:00:03.000Z"),
    ];
    const merged = mergeLogsById(existing, incoming);
    expect(merged.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("同 timestamp 边界重复（同 id）只保留一条（R-06）", () => {
    const ts = "2026-08-15T07:00:01.000Z";
    const existing = [makeLog("a", ts)];
    const incoming = [makeLog("a", ts), makeLog("b", "2026-08-15T07:00:02.000Z")];
    const merged = mergeLogsById(existing, incoming);
    expect(merged.filter((l) => l.id === "a")).toHaveLength(1);
    expect(merged.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("增量合并结果与全量拉取集合一致（无丢失无重复 id）", () => {
    const full = [
      makeLog("a", "2026-08-15T07:00:01.000Z"),
      makeLog("b", "2026-08-15T07:00:02.000Z"),
      makeLog("c", "2026-08-15T07:00:03.000Z"),
    ];
    // 模拟两次增量：先全量首拉 a，再两批增量各含 b、c
    let merged = mergeLogsById([full[0]!], [full[1]!]);
    merged = mergeLogsById(merged, [full[1]!, full[2]!]);
    expect(merged).toEqual(full);
  });
});

/** 渲染到主控日志可见（WorkerLogPanel 内嵌 AgentLogViewer，输出纯 stdout 行文本）。 */
function missionWithRunningWorker(): Mission {
  return {
    ...FAKE_MISSION,
    status: "running",
    workers: [
      {
        id: "w-1",
        role: "arch",
        objective: "x",
        status: "running",
        total_cost_usd: null,
        started_at: null,
        finished_at: null,
        artifacts: [],
      },
    ],
  };
}

async function renderDetailWithWorkerLog(): Promise<void> {
  mockCreateResolve(missionWithRunningWorker());
  render(<MissionConsole workspaceId="ws-1" />);
  fireEvent.change(screen.getByPlaceholderText(/描述你要/), {
    target: { value: "x" },
  });
  fireEvent.click(screen.getByRole("button", { name: "启动" }));
  await waitFor(() =>
    expect(hoisted.createMissionMock).toHaveBeenCalledTimes(1),
  );
  fireEvent.click(screen.getByRole("button", { name: "查看日志" }));
  await waitFor(() =>
    expect(hoisted.getAgentRunLogsMock).toHaveBeenCalledTimes(1),
  );
}

describe("WorkerLogPanel 5s 轮询增量游标（perf-remediation task-08）", () => {
  beforeEach(() => {
    cleanup();
    hoisted.createMissionMock.mockReset();
    mockCreateResolve();
    hoisted.getAgentRunLogsMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("首拉无游标全量；后续轮询传最早一条 timestamp 作 after 并增量合并", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // 首拉：无 after，全量两条
    hoisted.getAgentRunLogsMock.mockResolvedValueOnce([
      makeLog("a", "2026-08-15T07:00:01.000Z"),
      makeLog("b", "2026-08-15T07:00:02.000Z"),
    ]);
    await renderDetailWithWorkerLog();

    // 第二轮：增量响应一条新日志 + 同 timestamp 边界重复 b
    hoisted.getAgentRunLogsMock.mockResolvedValueOnce([
      makeLog("b", "2026-08-15T07:00:02.000Z"),
      makeLog("c", "2026-08-15T07:00:03.000Z"),
    ]);
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await waitFor(() =>
      expect(hoisted.getAgentRunLogsMock).toHaveBeenCalledTimes(2),
    );

    // 游标语义：after = 已见最早一条（a 的 timestamp）
    const secondCall = hoisted.getAgentRunLogsMock.mock.calls[1] as unknown[];
    expect(secondCall![2]).toBe("2026-08-15T07:00:01.000Z");
    // 合并结果：a/b/c 各一条（viewer 把相邻 assistant 行合并成一个 markdown 块，
    // 故用 body.textContent 断言集合，b 只出现一次 = id 去重生效）
    await waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("日志行 a");
      expect(text).toContain("日志行 c");
      expect(text.match(/日志行 b/g)).toHaveLength(1);
    });
    vi.useRealTimers();
  });

  it("游标空结果且本地日志超阈值：一次全量重拉兜底后恢复增量", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // 首拉：超阈值（> 200 条）
    const many = Array.from({ length: 201 }, (_, i) =>
      makeLog(`L${i}`, `2026-08-15T07:00:00.${String(i).padStart(3, "0")}Z`),
    );
    hoisted.getAgentRunLogsMock.mockResolvedValueOnce(many);
    await renderDetailWithWorkerLog();

    // 第二轮：游标空结果 → 触发一次无 after 全量重拉（兜底），拿回全部
    hoisted.getAgentRunLogsMock.mockResolvedValueOnce([]);
    hoisted.getAgentRunLogsMock.mockResolvedValueOnce(many);
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await waitFor(() =>
      expect(hoisted.getAgentRunLogsMock).toHaveBeenCalledTimes(3),
    );
    // 兜底重拉那次不传 after
    const fallbackCall = hoisted.getAgentRunLogsMock.mock.calls[2] as unknown[];
    expect(fallbackCall).toHaveLength(2);

    // 第三轮：恢复增量（带 after）
    hoisted.getAgentRunLogsMock.mockResolvedValueOnce([
      makeLog("NEW", "2026-08-15T08:00:00.000Z"),
    ]);
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await waitFor(() =>
      expect(hoisted.getAgentRunLogsMock).toHaveBeenCalledTimes(4),
    );
    const resumeCall = hoisted.getAgentRunLogsMock.mock.calls[3] as unknown[];
    expect(resumeCall![2]).toBe("2026-08-15T07:00:00.000Z");
    vi.useRealTimers();
  });
});
