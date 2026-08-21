/**
 * 项目团队会话页（/projects/{id}/missions）页面级测试。
 * task-16 / 2026-08-19-cross-workspace-team-mission / design §7.3 / FR-07 /
 * 验收（frontend vitest 无报错）。
 *
 * 被测：page.tsx（数据装配层：useParams 取项目 id → listProjectWorkspaces 加载
 * scope 候选 → 构建 wsTypeById / wsNameById 传 MissionConsole projectMode）+
 * MissionConsole projectMode 交互（scope 多选 / anchor 词表优先默认 / 提交链路）。
 * 页面直接内嵌渲染 MissionConsole（不 stub），故 scope/anchor/提交断言也在页面级覆盖。
 *
 * 覆盖：
 *   1. 渲染：scope 候选列出 + 类型徽标取 workspace-types 词表中文标签
 *      （前端代码 / 后端代码）+ 按项目 id 拉 listProjectWorkspaces +
 *      挂载即拉历史 listProjectMissions(pid, {limit:20})
 *   2. anchor 默认（design §7.1 词表优先）：先勾 backend-code → anchor 即后端，
 *      两 scope 同选默认保持后端；只勾 frontend-code → anchor 默认第一个；
 *      退选 anchor 所在工作区 → 重取默认，backend-code 胜过更早勾选的非后端
 *   3. 提交链路：objective + 勾 scope → createProjectMission(pid,
 *      {scope_workspace_ids, anchor_workspace_id, objective, mode:"team"})；
 *      scope 未勾时启动按钮 disabled（前端先拦，省一次 422）
 *   4. 空态：候选 [] → 「该项目尚未关联工作区」引导 + 项目维护页链接
 *   5. 错误态：listProjectWorkspaces reject → errMessage 红条 + 重新加载按钮
 *      可重发请求
 *
 * mock 范式（照 changes/__tests__/page.test.tsx + mission-console.test.tsx）：
 * vi.hoisted 同组 vi.fn + 部分 mock @/lib/workspace / @/lib/agent（保留类型与
 * ApiError 真身）；next/navigation mock useParams；next/link 平铺 <a>。
 * antd Button autoLetterSpacing（字间插空格）→ name 匹配用 \s* 正则兼容。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProjectMissionsPage from "@/app/(dashboard)/projects/[id]/missions/page";
import type { ProjectMissionResponse } from "@/lib/agent";
import type { WorkspaceBrief } from "@/lib/workspace";

// ── mocks（hoisted，让 mock 工厂能引用同一组 vi.fn）──────────────────────
const mocks = vi.hoisted(() => ({
  listProjectWorkspaces: vi.fn(),
  listProjectMissions: vi.fn(),
  createProjectMission: vi.fn(),
  getMission: vi.fn(),
}));

// page 从 @/lib/workspace 只用 listProjectWorkspaces（其余函数保留真身，
// MissionConsole / layout 组件链上还有别的消费方，不整模块替换）。
vi.mock("@/lib/workspace", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/workspace")>("@/lib/workspace");
  return { ...actual, listProjectWorkspaces: mocks.listProjectWorkspaces };
});

// MissionConsole projectMode 挂载即拉历史（listProjectMissions）、URL 无 ?mission
// 不调 getMission、提交走 createProjectMission——其余（类型 / ApiError）保留真身。
vi.mock("@/lib/agent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent")>("@/lib/agent");
  return {
    ...actual,
    listProjectMissions: mocks.listProjectMissions,
    createProjectMission: mocks.createProjectMission,
    getMission: mocks.getMission,
  };
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "proj-1" }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

// ── fixtures ───────────────────────────────────────────────────────────────

function makeBrief(over: Partial<WorkspaceBrief> = {}): WorkspaceBrief {
  return {
    workspace_id: "ws-front",
    name: "前端仓",
    status: "active",
    type: "frontend-code",
    role: null,
    description: null,
    ...over,
  };
}

/** 候选故意让 frontend-code 排第一个：anchor「词表优先」与「取第一个」可区分。 */
function makeCandidates(): WorkspaceBrief[] {
  return [
    makeBrief({
      workspace_id: "ws-front",
      name: "前端仓",
      type: "frontend-code",
      description: "Next.js 前端",
    }),
    makeBrief({
      workspace_id: "ws-back",
      name: "后端仓",
      type: "backend-code",
      description: "FastAPI 后端",
    }),
  ];
}

/** createProjectMission 响应（api-types MissionResponse 形状，task-14）。 */
const CREATED_MISSION: ProjectMissionResponse = {
  id: "miss-1",
  workspace_id: "ws-back", // anchor
  change_id: null,
  objective: "把销售数据整理成周报",
  status: "done", // 终态：不触发 10s 轮询，测试无定时器残留
  budget_usd: null,
  cost_so_far: 0,
  constraints: null,
  cancelled_at: null,
  created_at: "2026-08-19T00:00:00Z",
  workers: [],
  project_id: "proj-1",
  scope_workspace_ids: ["ws-back", "ws-front"],
  workspace_name: "后端仓",
  workspace_type: "backend-code",
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("项目团队会话页（task-15 / cross-workspace-team-mission）", () => {
  beforeEach(() => {
    // 每用例默认：两个候选（前端在前）+ 空历史 + 创建成功；用例内按需覆写
    mocks.listProjectWorkspaces.mockResolvedValue(makeCandidates());
    mocks.listProjectMissions.mockResolvedValue([]);
    mocks.createProjectMission.mockResolvedValue(CREATED_MISSION);
    // 重置 jsdom URL：前序用例创建成功会 writeMissionIdToUrl（?mission=miss-1），
    // 残留会让后续用例挂载时走深链分支（getMission mock 无返回值 → undefined.then）
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  // ── 1. 页面渲染：scope 候选 + 类型徽标 ────────────────────────────────

  it("加载后渲染 scope 候选与类型徽标（词表中文标签），按项目 id 拉候选与历史", async () => {
    render(<ProjectMissionsPage />);

    // 候选名单出现（listProjectWorkspaces 已 resolve）
    await waitFor(() =>
      expect(screen.getByText("前端仓")).toBeInTheDocument(),
    );
    expect(screen.getByText("后端仓")).toBeInTheDocument();

    // 类型徽标取 WORKSPACE_TYPE_OPTIONS 词表 label（frontend-code→前端代码 /
    // backend-code→后端代码，lib/workspace-types.ts 单一事实源）
    expect(screen.getByText("前端代码")).toBeInTheDocument();
    expect(screen.getByText("后端代码")).toBeInTheDocument();

    // scope 面板挂载：已选计数 + anchor 未选提示
    expect(
      screen.getByText(/派发范围（Scope）· 本次会话涉及的工作区（已选 0）/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/先在上方勾选派发范围，再选主工作区/),
    ).toBeInTheDocument();

    // 按路由项目 id 拉候选；MissionConsole projectMode 挂载即拉项目历史。
    // 历史拉取在挂载 effect 里发起，DOM 提交与 effect flush 是两个时点——
    // 满负载全量跑时 waitFor 见到候选名单时 effect 可能尚未执行（单文件跑
    // 掩盖了这一点），mock 断言同样要 waitFor，不能紧跟 DOM 断言同步判。
    expect(mocks.listProjectWorkspaces).toHaveBeenCalledWith("proj-1");
    await waitFor(() =>
      expect(mocks.listProjectMissions).toHaveBeenCalledWith("proj-1", {
        limit: 20,
      }),
    );
  });

  // ── 2. anchor 默认逻辑（design §7.1：backend-code 词表优先，否则第一个）──
  // 注：组件契约是「anchor 仅在未定 / 所在工作区退选时（重）取默认，已定且仍在
  // 范围内不切换」（mission-console toggleScope）——故两 scope 下默认 = 先勾
  // backend-code；词表优先分支的直接证据见下方 3 工作区退选重取用例。

  it("勾 backend-code → anchor 即后端；再勾前端两 scope 下默认保持后端；退选后端 → anchor 跟随回退前端", async () => {
    render(<ProjectMissionsPage />);
    await waitFor(() =>
      expect(screen.getByText("前端仓")).toBeInTheDocument(),
    );

    // 先勾后端 → 默认 anchor 即 backend-code 工作区
    fireEvent.click(screen.getByLabelText("派发范围勾选 后端仓"));
    expect(screen.getByLabelText("主工作区选择 后端仓")).toBeChecked();

    // 再勾前端（两 scope 都选）→ 默认 anchor 仍是 backend-code 那个
    fireEvent.click(screen.getByLabelText("派发范围勾选 前端仓"));
    expect(screen.getByLabelText("主工作区选择 后端仓")).toBeChecked();
    expect(screen.getByLabelText("主工作区选择 前端仓")).not.toBeChecked();

    // 退选后端（anchor 不在范围）→ 重取默认 = 剩余第一个（前端）
    fireEvent.click(screen.getByLabelText("派发范围勾选 后端仓"));
    expect(screen.getByLabelText("主工作区选择 前端仓")).toBeChecked();
    // 后端已退出 scope，anchor 选项区不再渲染它
    expect(
      screen.queryByLabelText("主工作区选择 后端仓"),
    ).not.toBeInTheDocument();
  });

  it("只勾 frontend-code 时 anchor 默认第一个（前端），无 backend-code 可选", async () => {
    render(<ProjectMissionsPage />);
    await waitFor(() =>
      expect(screen.getByText("前端仓")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByLabelText("派发范围勾选 前端仓"));
    // 无 backend-code 候选被勾 → 退化取第一个（前端）
    expect(screen.getByLabelText("主工作区选择 前端仓")).toBeChecked();
    expect(
      screen.queryByLabelText("主工作区选择 后端仓"),
    ).not.toBeInTheDocument();
  });

  it("词表优先分支：anchor 所在工作区退选后重取默认，backend-code 胜过更早勾选的非后端", async () => {
    // 3 候选（文档仓非后端类型）——重取默认时范围含多个工作区，直接检验
    // pickDefaultAnchor 的 find(backend-code) ?? 第一个 优先序。
    mocks.listProjectWorkspaces.mockResolvedValue([
      makeBrief({ workspace_id: "ws-front", name: "前端仓", type: "frontend-code" }),
      makeBrief({ workspace_id: "ws-doc", name: "文档仓", type: "business-doc" }),
      makeBrief({ workspace_id: "ws-back", name: "后端仓", type: "backend-code" }),
    ]);
    render(<ProjectMissionsPage />);
    await waitFor(() =>
      expect(screen.getByText("文档仓")).toBeInTheDocument(),
    );

    // 勾前端（anchor=前端）→ 勾文档、勾后端（anchor 保持前端）
    fireEvent.click(screen.getByLabelText("派发范围勾选 前端仓"));
    fireEvent.click(screen.getByLabelText("派发范围勾选 文档仓"));
    fireEvent.click(screen.getByLabelText("派发范围勾选 后端仓"));
    expect(screen.getByLabelText("主工作区选择 前端仓")).toBeChecked();

    // 退选 anchor 所在前端 → 重取默认：范围=[文档仓, 后端仓]，文档仓在前，
    // 但 backend-code 词表优先 → anchor = 后端仓（非第一个）
    fireEvent.click(screen.getByLabelText("派发范围勾选 前端仓"));
    expect(screen.getByLabelText("主工作区选择 后端仓")).toBeChecked();
    expect(screen.getByLabelText("主工作区选择 文档仓")).not.toBeChecked();
    expect(
      screen.queryByLabelText("主工作区选择 前端仓"),
    ).not.toBeInTheDocument();
  });

  // ── 3. 提交链路：createProjectMission(pid, {scope, anchor, …}) ────────

  it("objective + 勾 scope → 启动 → createProjectMission 收项目 id 与 scope/anchor", async () => {
    render(<ProjectMissionsPage />);
    await waitFor(() =>
      expect(screen.getByText("前端仓")).toBeInTheDocument(),
    );

    const startBtn = screen.getByRole("button", { name: "启动" });
    // 只填 objective 不勾 scope → projectMode 前端先拦（按钮 disabled）
    fireEvent.change(screen.getByPlaceholderText(/描述你要 AI 团队做什么/), {
      target: { value: "把销售数据整理成周报" },
    });
    expect(startBtn).toBeDisabled();

    // 勾 scope（后端先勾 → scope_workspace_ids 保持勾选顺序）
    fireEvent.click(screen.getByLabelText("派发范围勾选 后端仓"));
    fireEvent.click(screen.getByLabelText("派发范围勾选 前端仓"));
    expect(startBtn).toBeEnabled();

    fireEvent.click(startBtn);
    await waitFor(() =>
      expect(mocks.createProjectMission).toHaveBeenCalledTimes(1),
    );

    const [pid, input] = mocks.createProjectMission.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(pid).toBe("proj-1");
    expect(input.scope_workspace_ids).toEqual(["ws-back", "ws-front"]);
    expect(input.anchor_workspace_id).toBe("ws-back"); // 词表优先默认值显式上行
    expect(input.objective).toBe("把销售数据整理成周报");
    expect(input.mode).toBe("team"); // 固定 team（D-001@v1）
    // 单工作区创建通道不被触碰（projectMode 走项目端点）
    expect(mocks.createProjectMission).toHaveBeenCalledTimes(1);

    // 创建成功 → 切详情态（返回新建入口出现，MissionSummaryCard 挂载）
    expect(
      await screen.findByRole("button", { name: /返回新建/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
  });

  // ── 4. 空态：候选为空 → 引导文案 ──────────────────────────────────────

  it("候选 [] → 「该项目尚未关联工作区」引导 + 项目维护页链接", async () => {
    mocks.listProjectWorkspaces.mockResolvedValue([]);
    render(<ProjectMissionsPage />);

    await waitFor(() =>
      expect(
        screen.getByText(/该项目尚未关联工作区/),
      ).toBeInTheDocument(),
    );
    // 引导链接指向 PPM 项目维护页
    expect(screen.getByRole("link", { name: "项目维护页" })).toHaveAttribute(
      "href",
      "/ppm/projects",
    );
    // 无 scope 面板 / 提交表单（MissionConsole 不挂载）
    expect(
      screen.queryByText(/派发范围（Scope）/),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "启动" })).not.toBeInTheDocument();
  });

  // ── 5. 错误态：加载失败 → errMessage 红条 + 重新加载可重发 ────────────

  it("listProjectWorkspaces reject → 错误红条 + 重新加载按钮重发请求", async () => {
    mocks.listProjectWorkspaces.mockRejectedValue(new Error("网关超时"));
    render(<ProjectMissionsPage />);

    // errMessage(Error) → message 透传（红条展示）
    await waitFor(() =>
      expect(screen.getByText("网关超时")).toBeInTheDocument(),
    );
    // 加载中占位与表单均不出现
    expect(
      screen.queryByText(/正在加载项目关联的工作区/),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "启动" })).not.toBeInTheDocument();

    // 点重新加载 → 重新发起候选请求（antd Button 字间插空格，用 \s* 兼容）
    fireEvent.click(screen.getByRole("button", { name: /重\s*新\s*加\s*载/ }));
    await waitFor(() =>
      expect(mocks.listProjectWorkspaces).toHaveBeenCalledTimes(2),
    );
  });

  // ── 6. FE-P1-1（2026-08-21 审查）：degraded 是终态，不显示"取消任务" ──

  it("创建返回 degraded 终态 → 详情态不渲染「取消任务」按钮（终态不可取消）", async () => {
    mocks.createProjectMission.mockResolvedValue({
      ...CREATED_MISSION,
      status: "degraded",
    });
    render(<ProjectMissionsPage />);
    await waitFor(() =>
      expect(screen.getByText("前端仓")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText(/描述你要 AI 团队做什么/), {
      target: { value: "整理数据" },
    });
    fireEvent.click(screen.getByLabelText("派发范围勾选 后端仓"));
    fireEvent.click(screen.getByRole("button", { name: "启动" }));
    await waitFor(() =>
      expect(mocks.createProjectMission).toHaveBeenCalledTimes(1),
    );

    // degraded 是后端 derive_status 终态：无取消按钮、无 10s 轮询
    expect(
      await screen.findByRole("button", { name: /返回新建/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /取消任务/ }),
    ).not.toBeInTheDocument();
  });

  // ── 7. FE-P2-4（2026-08-21 审查）：budget 非法值阻断提交 ──────────────

  it("预算填 0/负数 → 启动被拦截并提示，不发创建请求", async () => {
    render(<ProjectMissionsPage />);
    await waitFor(() =>
      expect(screen.getByText("前端仓")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText(/描述你要 AI 团队做什么/), {
      target: { value: "整理数据" },
    });
    fireEvent.click(screen.getByLabelText("派发范围勾选 后端仓"));

    // 预算输入框（唯一 number input）
    const budgetField = screen.getByRole("spinbutton");
    fireEvent.change(budgetField, { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "启动" }));

    await waitFor(() =>
      expect(
        screen.getByText(/预算必须为正的有限数值/),
      ).toBeInTheDocument(),
    );
    expect(mocks.createProjectMission).not.toHaveBeenCalled();
  });

  // ── 8. FE-P1-4（2026-08-21 审查，部分）：历史 403 显式提示 ────────────

  it("listProjectMissions 403 → 显示「仅项目经理」权限提示（不再静默无历史）", async () => {
    const { ApiError } = await import("@/lib/api");
    mocks.listProjectMissions.mockRejectedValue(
      new ApiError(403, {
        code: "HTTP_403_PERMISSION_DENIED",
        message: "仅项目经理可创建项目团队会话。",
        request_id: null,
        details: null,
      }),
    );
    render(<ProjectMissionsPage />);

    await waitFor(() =>
      expect(screen.getByText(/仅项目经理可查看项目团队会话/)).toBeInTheDocument(),
    );
  });
});
