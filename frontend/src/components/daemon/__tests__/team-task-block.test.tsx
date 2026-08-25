// task-12（2026-08-22-team-session-unify / FR-07 / D-001@v1）：消息流团队任务块
// TeamTaskBlock 单测（行为规格，design §5 Phase 3 + 原型 §01 TeamTaskBlock）。
//
// 覆盖：
//   1. 概要行常驻——状态徽标（中文映射）/ N 分身成功失败计数 / 预算；
//   2. 展开明细——主控行 + 分身行（角色徽标 / 状态 / 目标 / 日志产物入口预留）；
//   3. 折叠交互——默认一律收起（ql-20260825-011）、active→终态保持折叠、手动切换；
//   4. 取消——两步确认 → cancelTeamMission(mission_id) → onRefresh；失败显示错误；
//      终态不渲染取消按钮；
//   5. isActiveTeamMission 纯函数（planning/running/awaiting_input）；
//   6. 引擎无关——纯 props 渲染，不依赖 Claude/Codex 分支（Codex 置灰逻辑归 task-11）；
//   7. task-14（2026-08-25-team-subsession-governance / FR-08 / design §5.E）：
//      子会话形态分身行（sub_session_id 非空）行主体可点击 → onOpenWorkerSession；
//      存量 batch 行（无字段）与未传回调时不可点击零回归；行尾日志/产物按钮
//      stopPropagation 不误触打开（嵌套可点元素互不干扰，constraints）。
//
// 测试纪律：FIRST / AAA / 每用例独立 fixture / 零 mock 被测组件内部；仅 mock
// lib/daemon 的 cancelTeamMission（网络层已由 lib/__tests__/daemon-team-mission.test.ts
// 覆盖，组件测试只验证调用与回调）。组件不用 antd（对齐 turn-segment-views 段族
// 惯例），按钮文本不会被 autoLetterSpacing 拆分，getByRole name 可用。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { TeamTaskBlock, isActiveTeamMission } from "../team-task-block";
import { cancelTeamMission, type TeamMissionSummary, TeamMissionWorkerSummary } from "@/lib/daemon";
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

/** ql-20260825-011：块默认收起——断言明细内容的用例先点开概要行。 */
function expandBlock() {
  fireEvent.click(screen.getByText("展开 ▾"));
}

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
  it("运行中：状态徽标 + 分身计数 + 预算；点开后见主控行与分身行", () => {
    render(<TeamTaskBlock summary={makeSummary()} />);
    expandBlock();

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
    expandBlock();
    // 单工作区范围：范围行 1 处 + 每个分身行各 1 处（原型 §01 分身行带目标工作区徽标）
    expect(screen.getAllByText("前端官网").length).toBe(4);
  });

  it("无分身：占位文案（主控接管后派发）", () => {
    render(<TeamTaskBlock summary={makeSummary({ workers: [] })} />);
    expandBlock();
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
    expandBlock();
    expect(screen.getByText("🧠 主控")).toBeInTheDocument(); // 手动展开

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
    expandBlock();

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
    expandBlock();
    fireEvent.click(screen.getByRole("button", { name: "取消任务" }));
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(cancelMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "取消任务" })).toBeInTheDocument();
  });

  it("取消失败：显示错误文案，不触发 onRefresh", async () => {
    cancelMock.mockRejectedValue(new Error("network down"));
    const onRefresh = vi.fn();
    render(<TeamTaskBlock summary={makeSummary()} onRefresh={onRefresh} />);
    expandBlock();

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
    expandBlock();
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
    expandBlock();
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
    expandBlock();
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
    expandBlock();
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
    expandBlock();
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
    expandBlock();
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
    expandBlock();
    fireEvent.click(screen.getAllByText("产物")[0]!);
    await waitFor(() =>
      expect(screen.getByText("暂无产物")).toBeInTheDocument(),
    );
  });
});

/* ───────── task-14：分身行点击打开子会话（FR-08 / design §5.E） ───────── */

describe("TeamTaskBlock task-14 分身行点击入口", () => {
  /**
   * 混合分身 fixture：r-sub 为子会话形态（sub_session_id 非空，可点击），
   * r-legacy 为存量 batch 行（无字段，不可点击）。
   * lib/daemon 手写类型暂未含新字段（本卡 allowed_paths 不含 lib/daemon.ts，
   * 组件内以 WorkerRowView intersect 消费）——此处 as 断言补齐，与组件同口径。
   */
  const MIXED_WORKERS = [
    {
      run_id: "r-sub",
      role: "impl",
      status: "running",
      objective: "子会话形态分身",
      workspace_id: null,
      sub_session_id: "sub-sess-1",
    },
    {
      run_id: "r-legacy",
      role: "test",
      status: "completed",
      objective: "存量 batch 分身",
      workspace_id: null,
    },
  ] as TeamMissionSummary["workers"];

  it("有 sub_session_id 的分身行：行主体可点击触发 onOpenWorkerSession(subSessionId)，附「查看会话」标识", () => {
    const onOpenWorkerSession = vi.fn();
    render(
      <TeamTaskBlock
        summary={makeSummary({ workers: MIXED_WORKERS })}
        onOpenWorkerSession={onOpenWorkerSession}
      />,
    );
    expandBlock();

    // 行主体 role=button（键盘可达语义）+ 行尾「查看会话」入口标识。
    const row = screen.getByRole("button", { name: "查看分身会话：实现" });
    expect(screen.getByText("查看会话 ›")).toBeInTheDocument();

    fireEvent.click(row);
    expect(onOpenWorkerSession).toHaveBeenCalledTimes(1);
    expect(onOpenWorkerSession).toHaveBeenCalledWith("sub-sess-1");
  });

  it("键盘可达：行本体 Enter 触发打开", () => {
    const onOpenWorkerSession = vi.fn();
    render(
      <TeamTaskBlock
        summary={makeSummary({ workers: MIXED_WORKERS })}
        onOpenWorkerSession={onOpenWorkerSession}
      />,
    );
    expandBlock();

    fireEvent.keyDown(screen.getByRole("button", { name: "查看分身会话：实现" }), {
      key: "Enter",
    });
    expect(onOpenWorkerSession).toHaveBeenCalledWith("sub-sess-1");
  });

  it("存量 batch 分身行（无 sub_session_id）不渲染点击态，点击不触发回调", () => {
    const onOpenWorkerSession = vi.fn();
    render(
      <TeamTaskBlock
        summary={makeSummary({ workers: MIXED_WORKERS })}
        onOpenWorkerSession={onOpenWorkerSession}
      />,
    );
    expandBlock();

    // 存量行无 role=button 行主体；入口标识全块仅 1 处（r-sub）。
    expect(
      screen.queryByRole("button", { name: "查看分身会话：测试" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("查看会话 ›").length).toBe(1);

    // 点击存量行目标文本不触发回调。
    fireEvent.click(screen.getByText("存量 batch 分身"));
    expect(onOpenWorkerSession).not.toHaveBeenCalled();
  });

  it("行尾日志/产物按钮 stopPropagation：点击展开明细不误触打开分身会话", async () => {
    const logsMock = vi.mocked(getAgentRunLogs).mockResolvedValue([]);
    const onOpenWorkerSession = vi.fn();
    render(
      <TeamTaskBlock
        summary={makeSummary({ workers: MIXED_WORKERS })}
        onOpenWorkerSession={onOpenWorkerSession}
      />,
    );
    expandBlock();

    // r-sub（第 1 个）的日志/产物按钮：点击只走自身逻辑，不上冒行主体。
    //（workspace 回落链：分身自身 null → scope[0]，见 handleToggleLogs。）
    fireEvent.click(screen.getAllByText("日志")[0]!);
    await waitFor(() =>
      expect(logsMock).toHaveBeenCalledWith(
        "11111111-2222-3333-4444-555555555555",
        "r-sub",
      ),
    );
    expect(onOpenWorkerSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByText("产物")[0]!);
    expect(onOpenWorkerSession).not.toHaveBeenCalled();
  });

  it("未传回调零回归：有 sub_session_id 的行也不渲染点击态，日志入口照常可用", async () => {
    const logsMock = vi.mocked(getAgentRunLogs).mockResolvedValue([]);
    render(<TeamTaskBlock summary={makeSummary({ workers: MIXED_WORKERS })} />);
    expandBlock();

    expect(
      screen.queryByRole("button", { name: "查看分身会话：实现" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("查看会话 ›")).not.toBeInTheDocument();

    // 既有交互不受影响：日志展开仍工作。
    fireEvent.click(screen.getAllByText("日志")[0]!);
    await waitFor(() => expect(logsMock).toHaveBeenCalled());
  });
});

/* ── UX 走查③（2026-08-26）：运行中分身 latest_action 预览 ── */
describe("TeamTaskBlock latest_action 预览（UX③）", () => {
  function renderBlock(workers: TeamMissionWorkerSummary[]) {
    render(
      <TeamTaskBlock
        summary={{
          mission_id: "m-1",
          status: "running",
          objective: "目标",
          scope_workspace_ids: [],
          scope_workspaces: [],
          budget_usd: null,
          workers,
        }}
      />,
    );
  }

  it("running 分身带 latest_action 时渲染预览行（↳ 前缀）", () => {
    renderBlock([
      {
        run_id: "r-1",
        role: "impl",
        status: "running",
        objective: "修 bug",
        workspace_id: null,
        sub_session_id: "sub-1",
        first_run_id: "r-1",
        latest_action: "正在编辑 app.py 第 10 行",
      },
    ]);
    expandBlock();
    expect(screen.getByText(/正在编辑 app.py 第 10 行/)).toBeVisible();
  });

  it("非 running 行 / 无 latest_action 行不渲染预览", () => {
    renderBlock([
      {
        run_id: "r-2",
        role: "impl",
        status: "completed",
        objective: "已完成",
        workspace_id: null,
        latest_action: null,
      },
    ]);
    expandBlock();
    expect(screen.queryByText(/↳/)).toBeNull();
  });
});
