// task-12（2026-08-22-team-session-unify / FR-07 / D-001@v1）：消息流团队任务块
// TeamTaskBlock 单测（行为规格，design §5 Phase 3 + 原型 §01 TeamTaskBlock）。
//
// 覆盖：
//   1. 概要行常驻——状态徽标（中文映射）/ N 分身成功失败计数 / 预算；
//   2. 展开明细——主控行 + 分身行（角色徽标 / 状态 / 目标 / 日志产物入口预留）；
//   3. 折叠交互——活跃态默认展开、终态默认折叠、active→终态自动收敛、手动切换；
//   4. 取消——两步确认 → cancelTeamMission(mission_id) → onRefresh；失败显示错误；
//      终态不渲染取消按钮；
//   5. isActiveTeamMission 纯函数（planning/running/awaiting_input）；
//   6. 引擎无关——纯 props 渲染，不依赖 Claude/Codex 分支（Codex 置灰逻辑归 task-11）。
//
// 测试纪律：FIRST / AAA / 每用例独立 fixture / 零 mock 被测组件内部；仅 mock
// lib/daemon 的 cancelTeamMission（网络层已由 lib/__tests__/daemon-team-mission.test.ts
// 覆盖，组件测试只验证调用与回调）。组件不用 antd（对齐 turn-segment-views 段族
// 惯例），按钮文本不会被 autoLetterSpacing 拆分，getByRole name 可用。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { TeamTaskBlock, isActiveTeamMission } from "../team-task-block";
import { cancelTeamMission, type TeamMissionSummary } from "@/lib/daemon";
import { getAgentRunLogs, getWorkerArtifacts } from "@/lib/agent";

vi.mock("@/lib/daemon", () => ({
  cancelTeamMission: vi.fn(),
}));

vi.mock("@/lib/agent", () => ({
  getAgentRunLogs: vi.fn(async () => [] as unknown[]),
  getWorkerArtifacts: vi.fn(async () => ({
    worker_id: "",
    status: "completed",
    artifacts: [],
  })),
}));

vi.mock("next/dynamic", () => ({
  default: (loader: unknown) => {
    // ql-20260825-004：MarkdownPreview 动态导入在 jsdom 测试中以加载态占位
    //（富渲染日志/产物的形态断言不依赖 Markdown 内容本身）。
    const Fake = () => null;
    Fake.displayName = "DynamicMock";
    Fake.preload = () => Promise.resolve();
    return Fake;
  },
}));
const cancelMock = vi.mocked(cancelTeamMission);

/* ───────── fixture ───────── */

function makeSummary(
  overrides: Partial<TeamMissionSummary> = {},
): TeamMissionSummary {
  return {
    mission_id: "m-1",
    status: "running",
    objective: "修复登录页移动端问题",
    scope_workspace_ids: ["11111111-2222-3333-4444-555555555555"],
    budget_usd: 5,
    workers: [
      { run_id: "r-1", role: "impl", status: "running", objective: "修按钮溢出", workspace_id: "11111111-2222-3333-4444-555555555555" },
      { run_id: "r-2", role: "test", status: "completed", objective: "补回归用例", workspace_id: "11111111-2222-3333-4444-555555555555" },
      { run_id: "r-3", role: "risk", status: "failed", objective: "扫描同类问题", workspace_id: "11111111-2222-3333-4444-555555555555" },
    ],
    ...overrides,
  };
}

/** 概要行容器（团队任务 lead 所在的 role=button 头部）。 */
function headerOf(): HTMLElement {
  const el = screen.getByText("团队任务").closest('div[role="button"]');
  if (!el) throw new Error("team block header not found");
  return el as HTMLElement;
}

beforeEach(() => {
  cancelMock.mockReset();
});

/* ───────── 1/2. 概要行 + 展开明细 ───────── */

describe("TeamTaskBlock 概要行与明细", () => {
  it("运行中：状态徽标 + 分身计数 + 预算；默认展开见主控行与分身行", () => {
    render(<TeamTaskBlock summary={makeSummary()} />);

    // 概要行（badge / 统计 / 预算各为单一文本节点）。「运行中」出现两处：
    // 概要行徽标 + impl 分身行状态（主控行不重复 mission 状态）。
    expect(screen.getAllByText("运行中").length).toBe(2);
    expect(screen.getByText("3 分身 · 成功 1 / 失败 1")).toBeInTheDocument();
    expect(screen.getByText("预算 $5.00")).toBeInTheDocument();
    expect(headerOf()).toHaveAttribute("aria-expanded", "true");

    // 主控行（mission objective 作为主控目标）
    expect(screen.getByText("🧠 主控")).toBeInTheDocument();
    expect(screen.getByText("修复登录页移动端问题")).toBeInTheDocument();

    // 分身行：角色中文徽标 + 状态 + 目标
    expect(screen.getByText("实现")).toBeInTheDocument();
    expect(screen.getByText("测试")).toBeInTheDocument();
    expect(screen.getByText("风险")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument(); // r-2 唯一
    expect(screen.getByText("失败")).toBeInTheDocument(); // r-3 唯一
    expect(screen.getByText("修按钮溢出")).toBeInTheDocument();
    expect(screen.getByText("补回归用例")).toBeInTheDocument();

    // 日志 / 产物入口预留（每个分身行各一）
    expect(screen.getAllByText("日志").length).toBe(3);
    expect(screen.getAllByText("产物").length).toBe(3);
  });

  it("预算缺省显示「未设预算」", () => {
    render(<TeamTaskBlock summary={makeSummary({ budget_usd: null })} />);
    expect(screen.getByText("未设预算")).toBeInTheDocument();
  });

  it("范围徽标：workspaceMeta 提供时显示工作区名 + 类型配色", () => {
    render(
      <TeamTaskBlock
        summary={makeSummary()}
        workspaceMeta={{
          "11111111-2222-3333-4444-555555555555": {
            name: "前端官网",
            type: "frontend-code",
          },
        }}
      />,
    );
    // 单工作区范围：范围行 1 处 + 每个分身行各 1 处（原型 §01 分身行带目标工作区徽标）
    expect(screen.getAllByText("前端官网").length).toBe(4);
  });

  it("无分身：占位文案（主控接管后派发）", () => {
    render(<TeamTaskBlock summary={makeSummary({ workers: [] })} />);
    expect(screen.getByText("暂无分身。主控接管后将按预设派发。")).toBeInTheDocument();
    expect(screen.getByText("0 分身 · 成功 0 / 失败 0")).toBeInTheDocument();
  });

  it("全状态徽标中文映射（awaiting_input 等扩展档）", () => {
    const { unmount } = render(
      <TeamTaskBlock summary={makeSummary({ status: "awaiting_input" })} />,
    );
    expect(screen.getByText("等待输入")).toBeInTheDocument();
    unmount();

    render(<TeamTaskBlock summary={makeSummary({ status: "degraded" })} />);
    expect(screen.getByText("部分完成")).toBeInTheDocument();
  });
});

/* ───────── 3. 折叠交互 ───────── */

describe("TeamTaskBlock 折叠交互", () => {
  it("终态默认折叠：概要行仍在，明细未挂载；点击展开再收起", () => {
    render(<TeamTaskBlock summary={makeSummary({ status: "done" })} />);
    expect(screen.getByText("已完成")).toBeInTheDocument(); // 概要行徽标
    expect(headerOf()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("🧠 主控")).not.toBeInTheDocument();

    fireEvent.click(headerOf());
    expect(headerOf()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("🧠 主控")).toBeInTheDocument();

    fireEvent.click(headerOf());
    expect(screen.queryByText("🧠 主控")).not.toBeInTheDocument();
  });

  it("active → 终态过渡自动收敛为折叠（父层 5s 轮询重渲染场景）", () => {
    const { rerender } = render(<TeamTaskBlock summary={makeSummary()} />);
    expect(screen.getByText("🧠 主控")).toBeInTheDocument(); // 运行中默认展开

    rerender(<TeamTaskBlock summary={makeSummary({ status: "done" })} />);
    expect(screen.queryByText("🧠 主控")).not.toBeInTheDocument(); // 过渡即折叠
  });
});

/* ───────── 4. 取消（两步确认 → 保留端点 → 刷新） ───────── */

describe("TeamTaskBlock 取消", () => {
  it("两步确认后调 cancelTeamMission(mission_id) 并触发 onRefresh", async () => {
    cancelMock.mockResolvedValue(undefined);
    const onRefresh = vi.fn();
    render(<TeamTaskBlock summary={makeSummary()} onRefresh={onRefresh} />);

    // 第一步：进入确认态（不直接发请求）
    fireEvent.click(screen.getByRole("button", { name: "取消任务" }));
    expect(cancelMock).not.toHaveBeenCalled();
    expect(screen.getByText(/确认取消该团队任务/)).toBeInTheDocument();

    // 第二步：确认 → 调用 + 刷新
    fireEvent.click(screen.getByRole("button", { name: "确认取消" }));
    await waitFor(() => expect(cancelMock).toHaveBeenCalledTimes(1));
    expect(cancelMock).toHaveBeenCalledWith("m-1");
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it("确认态可返回（不发起取消）", () => {
    render(<TeamTaskBlock summary={makeSummary()} />);
    fireEvent.click(screen.getByRole("button", { name: "取消任务" }));
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(cancelMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "取消任务" })).toBeInTheDocument();
  });

  it("取消失败：显示错误文案，不触发 onRefresh", async () => {
    cancelMock.mockRejectedValue(new Error("network down"));
    const onRefresh = vi.fn();
    render(<TeamTaskBlock summary={makeSummary()} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: "取消任务" }));
    fireEvent.click(screen.getByRole("button", { name: "确认取消" }));

    await waitFor(() => expect(cancelMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText("取消团队任务失败")).toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("终态不渲染取消按钮", () => {
    render(<TeamTaskBlock summary={makeSummary({ status: "done" })} />);
    expect(screen.queryByRole("button", { name: "取消任务" })).not.toBeInTheDocument();
  });
});

/* ───────── 5. isActiveTeamMission 纯函数 ───────── */

describe("isActiveTeamMission（父层 5s 轮询启停判据）", () => {
  it("planning/running/awaiting_input 为活跃；终态全部停止", () => {
    expect(isActiveTeamMission("planning")).toBe(true);
    expect(isActiveTeamMission("running")).toBe(true);
    expect(isActiveTeamMission("awaiting_input")).toBe(true);
    expect(isActiveTeamMission("done")).toBe(false);
    expect(isActiveTeamMission("degraded")).toBe(false);
    expect(isActiveTeamMission("failed")).toBe(false);
    expect(isActiveTeamMission("cancelled")).toBe(false);
    expect(isActiveTeamMission("unknown-future")).toBe(false);
  });
});

/* ───────── 6. 引擎无关 ───────── */

describe("TeamTaskBlock 引擎无关（Codex 置灰逻辑归 task-11 挂载层）", () => {
  it("纯 props 渲染，无 Claude/Codex 分支文案", () => {
    render(<TeamTaskBlock summary={makeSummary()} />);
    expect(screen.queryByText(/Claude/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Codex/)).not.toBeInTheDocument();
    expect(screen.queryByText(/团队需要/)).not.toBeInTheDocument();
  });
});

/* ───────── ql-20260825-003：scope 名称链 + 分身自身工作区徽标 + 日志按分身工作区 ───────── */

describe("TeamTaskBlock ql-20260825-003", () => {
  it("范围徽标：无 workspaceMeta 时回落 summary.scope_workspaces 名称", () => {
    const summary = makeSummary({
      scope_workspace_ids: ["aaaaaaaa-0000-0000-0000-000000000001", "aaaaaaaa-0000-0000-0000-000000000002"],
      scope_workspaces: [
        { id: "aaaaaaaa-0000-0000-0000-000000000001", name: "sillyspec" },
        { id: "aaaaaaaa-0000-0000-0000-000000000002", name: null },
      ],
    });
    render(<TeamTaskBlock summary={summary} />);
    // 有名 → 名称徽标；无名 → #<id8> 原始徽标兜底
    expect(screen.getByText("sillyspec")).toBeTruthy();
    expect(screen.getByText("#aaaaaaaa")).toBeTruthy();
  });

  it("分身行显示自身工作区徽标（多 scope 也显示）", () => {
    const summary = makeSummary({
      scope_workspace_ids: ["aaaaaaaa-0000-0000-0000-000000000001", "aaaaaaaa-0000-0000-0000-000000000002"],
      scope_workspaces: [
        { id: "aaaaaaaa-0000-0000-0000-000000000001", name: "sillyspec" },
        { id: "aaaaaaaa-0000-0000-0000-000000000002", name: "multi-agent-platform" },
      ],
      workers: [
        {
          run_id: "r-cross",
          role: "impl",
          status: "running",
          objective: "跨区任务",
          workspace_id: "aaaaaaaa-0000-0000-0000-000000000002",
        },
      ],
    });
    render(<TeamTaskBlock summary={summary} />);
    expect(screen.getAllByText("multi-agent-platform").length).toBe(2);
  });

  it("日志请求按分身自身 workspace（跨区分身不再打 scope[0]）", async () => {
    const logsMock = vi.mocked(getAgentRunLogs).mockResolvedValue([]);
    const summary = makeSummary({
      scope_workspace_ids: ["aaaaaaaa-0000-0000-0000-000000000001", "aaaaaaaa-0000-0000-0000-000000000002"],
      workers: [
        {
          run_id: "r-cross",
          role: "impl",
          status: "completed",
          objective: "跨区任务",
          workspace_id: "aaaaaaaa-0000-0000-0000-000000000002",
        },
      ],
    });
    render(<TeamTaskBlock summary={summary} />);
    fireEvent.click(screen.getByText("日志"));
    await waitFor(() =>
      expect(logsMock).toHaveBeenCalledWith(
        "aaaaaaaa-0000-0000-0000-000000000002",
        "r-cross",
      ),
    );
  });
});

/* ───────── ql-20260825-004：产物数据源改 worker result 端点 + 富渲染 ───────── */

describe("TeamTaskBlock ql-20260825-004 产物", () => {
  it("产物按钮调 getWorkerArtifacts(mission_id, worker) 而非文件上传端点", async () => {
    const artifactsMock = vi.mocked(getWorkerArtifacts).mockResolvedValue({
      worker_id: "r-1",
      status: "completed",
      artifacts: [],
    });
    render(<TeamTaskBlock summary={makeSummary()} />);
    fireEvent.click(screen.getAllByText("产物")[0]!);
    await waitFor(() => expect(artifactsMock).toHaveBeenCalled());
    expect(artifactsMock).toHaveBeenCalledWith(
      "11111111-2222-3333-4444-555555555555",
      "m-1",
      "r-1",
    );
  });

  it("summary 产物渲染为「分析报告」卡（Markdown）", async () => {
    vi.mocked(getWorkerArtifacts).mockResolvedValue({
      worker_id: "r-1",
      status: "completed",
      artifacts: [
        { id: "a-1", kind: "summary", content_ref: "## 分析结果\n内容…" },
      ],
    });
    render(<TeamTaskBlock summary={makeSummary()} />);
    fireEvent.click(screen.getAllByText("产物")[0]!);
    await waitFor(() =>
      expect(screen.getByText("分析报告")).toBeInTheDocument(),
    );
  });

  it("无产物时显示「暂无产物」", async () => {
    vi.mocked(getWorkerArtifacts).mockResolvedValue({
      worker_id: "r-1",
      status: "completed",
      artifacts: [],
    });
    render(<TeamTaskBlock summary={makeSummary()} />);
    fireEvent.click(screen.getAllByText("产物")[0]!);
    await waitFor(() =>
      expect(screen.getByText("暂无产物")).toBeInTheDocument(),
    );
  });
});
