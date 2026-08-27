// task-11（2026-08-22-team-session-unify / FR-03 / D-003 / D-004）：
// 派团队触发配置弹层 TeamTriggerPopover 单测（行为规格，design §5 Phase 3 +
// 原型 prototype-team-session-unify.html §02 .team-pop）。
//
// 覆盖：
//   1. 渲染默认——范围默认「当前工作区」（显示工作区名）/ 预算留空不限 /
//      分身预设默认折叠（主控配置字段不可见）；
//   2. 确认回调——工作区模式 payload 最小形态（objective 可空 + budget_usd null，
//      scope 走会话绑定工作区缺省，不传 scope_workspace_ids）；
//   3. objective 预填（/team 指令文本 / 「用团队分析」提示句）进输入框与 payload；
//   4. 预算校验——非正数 / 非法文本 → 中文错误 + onTrigger 不触发；
//   5. 项目维度——项目下拉（listProjects 数据范围=超管全部/经理+创建人）→
//      选项目拉关联工作区（listProjectWorkspaces）→ scope 多选 → anchor 胶囊
//      按 backend-code 优先派生展示 → payload 带 project_id + scope_workspace_ids；
//      未选工作区 → 中文错误；
//   6. 分身预设折叠展开——主控配置 + 添加分身 → payload 带 worker_preset +
//      main_agent_config；未展开（默认）不带（走主控自动拆解 / 服务端默认）；
//   7. 取消回调 onClose。
//
// task-12（2026-08-24-session-team-mission-context / FR-03 / FR-06 / D-008@v2 /
// D-010@v1）追加覆盖（文末新 describe，既有断言不动）：
//   8. 弹层打开即对候选集（workspaceId）probe 一次（POST /api/workspaces/probe
//      via @/lib/api apiFetch），无轮询；项目切换候选集变化补拉一次（同候选集不重复）；
//   9. 工作区行（scope 多选 + 当前工作区卡）meta：机器名（daemon_name）+ 在线 dot
//      （on/off/none 三态）+ git 模式标签（git 隔离/非 git · 直通/模式未知）；
//      未绑（daemon_name=null）显示「未绑机器」；
//  10. 主 agent（项目经理）选择器仅 preSession 实例渲染：默认「当前会话」+
//      scope 已选工作区选项；daemon_online=false/未绑 → option disabled；确认
//      payload.orchestrator_workspace_id（选工作区=其 id、默认=null）；非 preSession
//      实例不渲染选择器且 payload 不含该字段；
//  11. probe 失败 fail-safe：meta 标签缺失不阻断弹层可用（确认照常回调）。
//
// 测试纪律：FIRST / AAA / 仅 mock 网络层（@/lib/ppm/project listProjects +
// @/lib/workspace listProjectWorkspaces + @/lib/api apiFetch——probe 为组件文件内
// module-level 函数，网络边界即 apiFetch）；组件纯受控（onTrigger/onClose 回调），
// API 调用归 session-panel（父层）。组件不用 antd（对齐段族惯例，规避中文
// autoLetterSpacing 拆分坑），getByText/getByRole 直接可用。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import { TeamTriggerPopover } from "../team-trigger-popover";
import { listProjects } from "@/lib/ppm/project";
import { listProjectWorkspaces } from "@/lib/workspace";
import { apiFetch } from "@/lib/api";
import type { TeamMissionTriggerRequest } from "@/lib/daemon";

vi.mock("@/lib/ppm/project", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ppm/project")>(
    "@/lib/ppm/project",
  );
  return { ...actual, listProjects: vi.fn() };
});

vi.mock("@/lib/workspace", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace")>(
    "@/lib/workspace",
  );
  return { ...actual, listProjectWorkspaces: vi.fn() };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn() };
});

const listProjectsMock = vi.mocked(listProjects);
const listProjectWorkspacesMock = vi.mocked(listProjectWorkspaces);
const apiFetchMock = vi.mocked(apiFetch);

/* ───────── fixture ───────── */

function makeProject(id: string, name: string) {
  return {
    id,
    create_name: null,
    company_name: null,
    project_name: name,
    project_code: `P-${id}`,
    project_status: "进行中",
    project_type: null,
    project_effective_start_time: null,
    project_effective_end_time: null,
    project_maintenance_end_time: null,
    created_by: null,
    updated_by: null,
    created_at: "2026-08-22T00:00:00",
    updated_at: "2026-08-22T00:00:00",
  };
}

function makeWs(id: string, name: string, type: string | null) {
  return {
    workspace_id: id,
    name,
    status: "active",
    type,
    role: null,
    description: null,
  };
}

const HANDLERS = {
  onTrigger: vi.fn(),
  onClose: vi.fn(),
};

/** last payload（断言便捷）。task-12：preSession 实例追加 orchestrator_workspace_id（组件内类型交集，task-13 归 lib）。 */
function lastPayload(): TeamMissionTriggerRequest & {
  orchestrator_workspace_id?: string | null;
} {
  const calls = HANDLERS.onTrigger.mock.calls;
  return calls[calls.length - 1]![0] as TeamMissionTriggerRequest & {
    orchestrator_workspace_id?: string | null;
  };
}

function setup(overrides: Record<string, unknown> = {}) {
  return render(
    <TeamTriggerPopover
      workspaceId="11111111-2222-3333-4444-555555555555"
      workspaceName="前端官网"
      onTrigger={HANDLERS.onTrigger}
      onClose={HANDLERS.onClose}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // 默认项目加载失败 → 仅当前工作区（各用例按需覆盖）。
  listProjectsMock.mockResolvedValue([]);
  listProjectWorkspacesMock.mockResolvedValue([]);
  // 默认 probe 空响应 → meta 行不渲染（既有用例渲染不变；新用例按需覆盖）。
  apiFetchMock.mockResolvedValue([]);
});

/* ───────── 1/2. 渲染默认 + 最小 payload ───────── */

describe("TeamTriggerPopover 渲染与确认（工作区模式）", () => {
  it("默认渲染：标题/说明/当前工作区选中/预算留空提示/分身预设折叠", async () => {
    setup();

    expect(screen.getByText("派团队做这件事")).toBeInTheDocument();
    expect(
      screen.getByText(/当前会话的智能体升级为主控/),
    ).toBeInTheDocument();

    // 范围默认「当前工作区」：显示工作区名 + 选中态（radio checked）。
    expect(screen.getByText("前端官网")).toBeInTheDocument();
    const wsRadio = screen.getByRole("radio", { name: /当前工作区/ });
    expect(wsRadio).toBeChecked();

    // 分身预设默认折叠：主控配置字段不可见。
    expect(screen.queryByLabelText("主控 AI 类型")).not.toBeInTheDocument();

    // 确认按钮 + 提示语（原型 .pop-foot）。
    expect(screen.getByRole("button", { name: /就绪，随下条消息发出/ })).toBeInTheDocument();
  });

  it("确认：最小 payload（objective 留空 → null、budget 留空 → null、不带 scope/project/preset）", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /就绪，随下条消息发出/ }));

    await waitFor(() => expect(HANDLERS.onTrigger).toHaveBeenCalledTimes(1));
    expect(lastPayload()).toEqual({
      objective: null,
      budget_usd: null,
    });
  });

  it("预算填正数 → payload.budget_usd 数字", async () => {
    setup();
    fireEvent.change(screen.getByLabelText(/费用上限/), {
      target: { value: "5.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: /就绪，随下条消息发出/ }));

    await waitFor(() => expect(HANDLERS.onTrigger).toHaveBeenCalledTimes(1));
    expect(lastPayload().budget_usd).toBe(5.5);
  });
});

/* ───────── 3. objective 预填 ───────── */

describe("TeamTriggerPopover objective 预填", () => {
  it("defaultObjective 预填目标输入框并进 payload（/team 指令文本）", async () => {
    setup({ defaultObjective: "修掉登录页三处移动端问题并补回归用例" });

    const objInput = screen.getByLabelText(/^目标/) as HTMLInputElement;
    expect(objInput.value).toBe("修掉登录页三处移动端问题并补回归用例");

    fireEvent.click(screen.getByRole("button", { name: /就绪，随下条消息发出/ }));
    await waitFor(() => expect(HANDLERS.onTrigger).toHaveBeenCalledTimes(1));
    expect(lastPayload().objective).toBe(
      "修掉登录页三处移动端问题并补回归用例",
    );
  });
});

/* ───────── 4. 预算校验 ───────── */

describe("TeamTriggerPopover 预算校验", () => {
  it.each(["0", "-3", "abc"])("非法预算 %s → 中文错误且不回调", async (bad) => {
    setup();
    fireEvent.change(screen.getByLabelText(/费用上限/), {
      target: { value: bad },
    });
    fireEvent.click(screen.getByRole("button", { name: /就绪，随下条消息发出/ }));

    expect(
      await screen.findByText(/预算必须为正的有限数值/),
    ).toBeInTheDocument();
    expect(HANDLERS.onTrigger).not.toHaveBeenCalled();
  });
});

/* ───────── 5. 项目维度 ───────── */

describe("TeamTriggerPopover 项目维度（scope 多选 + anchor 胶囊）", () => {
  it("项目下拉渲染可见项目（listProjects），选项目 → 拉关联工作区多选", async () => {
    listProjectsMock.mockResolvedValue([
      makeProject("p-1", "网站重构项目"),
      makeProject("p-2", "移动端项目"),
    ]);
    listProjectWorkspacesMock.mockResolvedValue([
      makeWs("ws-fe", "前端官网", "frontend-code"),
      makeWs("ws-be", "后端服务", "backend-code"),
      makeWs("ws-doc", "部署运维", "devops"),
    ]);
    setup();

    // 切到项目维度（等项目列表加载完成、radio 可点）。
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /项目维度/ })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("radio", { name: /项目维度/ }));
    const select = (await screen.findByLabelText(/选择项目/)) as HTMLSelectElement;
    // 首项为「请选择项目」占位，其后为可见项目。
    expect(select.options.length).toBe(3);
    expect(select.options[1]!.text).toBe("网站重构项目");

    fireEvent.change(select, { target: { value: "p-1" } });
    expect(await screen.findByText("后端服务")).toBeInTheDocument();

    // 勾选 scope（前端 + 后端）。
    fireEvent.click(screen.getByRole("checkbox", { name: /勾选工作区 前端官网/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /勾选工作区 后端服务/ }));

    // anchor 胶囊：backend-code 优先（服务端派生同规则，信息展示）。
    expect(screen.getByText(/主控将运行在/)).toBeInTheDocument();
    expect(screen.getByTestId("team-anchor-name").textContent).toBe(
      "后端服务",
    );

    fireEvent.click(screen.getByRole("button", { name: /就绪，随下条消息发出/ }));
    await waitFor(() => expect(HANDLERS.onTrigger).toHaveBeenCalledTimes(1));
    expect(lastPayload()).toEqual(
      expect.objectContaining({
        project_id: "p-1",
        scope_workspace_ids: ["ws-fe", "ws-be"],
      }),
    );
  });

  it("项目模式未勾工作区 → 中文错误且不回调", async () => {
    listProjectsMock.mockResolvedValue([makeProject("p-1", "网站重构项目")]);
    listProjectWorkspacesMock.mockResolvedValue([makeWs("ws-be", "后端服务", "backend-code")]);
    setup();

    fireEvent.click(screen.getByRole("radio", { name: /项目维度/ }));
    fireEvent.change(await screen.findByLabelText(/选择项目/), {
      target: { value: "p-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /就绪，随下条消息发出/ }));

    expect(
      await screen.findByText(/勾选至少一个工作区/),
    ).toBeInTheDocument();
    expect(HANDLERS.onTrigger).not.toHaveBeenCalled();
  });

  it("无可见项目（非项目经理/加载失败）→ 项目维度禁用 + 说明，仅当前工作区可选", async () => {
    listProjectsMock.mockResolvedValue([]);
    setup();

    const projectRadio = screen.getByRole("radio", { name: /项目维度/ });
    expect(projectRadio).toBeDisabled();
    expect(await screen.findByText(/暂无可选项目/)).toBeInTheDocument();
  });

  it("会话未绑定工作区：当前工作区选项禁用 + 默认切项目维度", async () => {
    listProjectsMock.mockResolvedValue([makeProject("p-1", "网站重构项目")]);
    listProjectWorkspacesMock.mockResolvedValue([makeWs("ws-be", "后端服务", "backend-code")]);
    setup({ workspaceId: null, workspaceName: null });

    const wsRadio = screen.getByRole("radio", { name: /当前工作区/ });
    expect(wsRadio).toBeDisabled();
    const projectRadio = screen.getByRole("radio", { name: /项目维度/ });
    expect(projectRadio).toBeChecked();
  });
});

/* ───────── 6. 分身预设折叠 ───────── */

describe("TeamTriggerPopover 分身预设折叠", () => {
  it("展开 → 主控配置可见；添加分身并填写 → payload 带 worker_preset + main_agent_config", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /分身预设/ }));

    expect(screen.getByLabelText("主控 AI 类型")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /添加分身/ }));
    fireEvent.change(screen.getByLabelText(/分身 1 分工目标/), {
      target: { value: "修登录页按钮溢出" },
    });
    fireEvent.click(screen.getByRole("button", { name: /就绪，随下条消息发出/ }));

    await waitFor(() => expect(HANDLERS.onTrigger).toHaveBeenCalledTimes(1));
    const payload = lastPayload();
    expect(payload.worker_preset).toHaveLength(1);
    expect(payload.worker_preset![0]).toEqual(
      expect.objectContaining({ objective: "修登录页按钮溢出", role: "impl" }),
    );
    expect(payload.main_agent_config).toEqual(
      expect.objectContaining({ agent_type: "claude_code", provider: "claude" }),
    );
  });

  it("默认（未展开预设）→ payload 不带 worker_preset / main_agent_config（主控自动拆解）", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /就绪，随下条消息发出/ }));

    await waitFor(() => expect(HANDLERS.onTrigger).toHaveBeenCalledTimes(1));
    expect(lastPayload().worker_preset).toBeUndefined();
    expect(lastPayload().main_agent_config).toBeUndefined();
  });
});

/* ───────── 7. 取消 ───────── */

describe("TeamTriggerPopover 取消", () => {
  it("取消按钮 → onClose，不触发 onTrigger", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(HANDLERS.onClose).toHaveBeenCalledTimes(1);
    expect(HANDLERS.onTrigger).not.toHaveBeenCalled();
  });

  it("submitting 时确认按钮禁用（文案转「派发中…」）", () => {
    setup({ submitting: true });
    expect(
      (screen.getByRole("button", { name: /派发中/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

/* ───────────────── 8. task-12：弹层 probe 一次拉取（无轮询） ───────────────── */

const CURRENT_WS_ID = "11111111-2222-3333-4444-555555555555";

/** task-10 probe 契约响应项 fixture（组件文件内本地类型的字面量形态）。 */
function probeItem(
  workspace_id: string,
  overrides: Partial<{
    git_mode: "git" | "direct" | "unknown";
    daemon_name: string | null;
    daemon_online: boolean;
  }> = {},
) {
  return {
    workspace_id,
    git_mode: "git" as const,
    daemon_name: "牛逼的电脑💻",
    daemon_online: true,
    ...overrides,
  };
}

describe("TeamTriggerPopover 弹层 probe（POST /api/workspaces/probe）", () => {
  it("弹层打开即对候选集（workspaceId）probe 一次，无定时器轮询", async () => {
    apiFetchMock.mockResolvedValue([
      probeItem(CURRENT_WS_ID, { daemon_online: true }),
    ]);
    setup();

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    expect(apiFetchMock).toHaveBeenCalledWith("/api/workspaces/probe", {
      method: "POST",
      json: { workspace_ids: [CURRENT_WS_ID] },
    });

    // 无轮询：静置一段时间后仍是单次调用（实现无 setInterval/定时器）。
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });

  it("项目切换候选集变化 → 事件驱动补拉一次；同候选集不重复拉", async () => {
    apiFetchMock.mockResolvedValue([]);
    listProjectsMock.mockResolvedValue([
      makeProject("p-1", "网站重构项目"),
      makeProject("p-2", "设计协作项目"),
    ]);
    listProjectWorkspacesMock.mockImplementation(async (projectId: string) =>
      projectId === "p-1"
        ? [makeWs("ws-a", "sillyspec", "backend-code"), makeWs("ws-b", "平台前端", "frontend-code")]
        : [makeWs("ws-c", "共享文档盘", "docs")],
    );
    setup();

    // mount：候选集=[当前工作区]。
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    expect(apiFetchMock).toHaveBeenLastCalledWith("/api/workspaces/probe", {
      method: "POST",
      json: { workspace_ids: [CURRENT_WS_ID] },
    });

    // 选 p-1 → 项目工作区加载完成 → 补拉一次（候选集=当前+2）。
    fireEvent.click(screen.getByRole("radio", { name: /项目维度/ }));
    fireEvent.change(await screen.findByLabelText(/选择项目/), {
      target: { value: "p-1" },
    });
    await screen.findByText("sillyspec");
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    expect(apiFetchMock).toHaveBeenLastCalledWith("/api/workspaces/probe", {
      method: "POST",
      json: { workspace_ids: [CURRENT_WS_ID, "ws-a", "ws-b"] },
    });

    // 切 p-2：加载中间态（list→null 候选集回落 mount 集）不重复拉；新列表到达补拉一次。
    fireEvent.change(screen.getByLabelText(/选择项目/), {
      target: { value: "p-2" },
    });
    await screen.findByText("共享文档盘");
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(3));
    expect(apiFetchMock).toHaveBeenLastCalledWith("/api/workspaces/probe", {
      method: "POST",
      json: { workspace_ids: [CURRENT_WS_ID, "ws-c"] },
    });

    // 再切回 p-1：候选集曾拉过 → 静态快照沿用，不重复拉。
    fireEvent.change(screen.getByLabelText(/选择项目/), {
      target: { value: "p-1" },
    });
    await screen.findByText("sillyspec");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(3);
  });
});

/* ───────────────── 9. task-12：工作区行机器状态 meta（原型场景①②） ───────────────── */

describe("TeamTriggerPopover 工作区行机器状态 meta", () => {
  it("当前工作区卡：机器名+在线 dot(on)+git 隔离标签（场景②）", async () => {
    apiFetchMock.mockResolvedValue([
      probeItem(CURRENT_WS_ID, { daemon_name: "牛逼的电脑💻", daemon_online: true, git_mode: "git" }),
    ]);
    setup();

    expect(await screen.findByText("牛逼的电脑💻 · 在线")).toBeInTheDocument();
    expect(screen.getByText("git 隔离")).toBeInTheDocument();
    const dot = screen.getByTestId(`probe-dot-${CURRENT_WS_ID}`);
    expect(dot.getAttribute("data-state")).toBe("on");
  });

  it("scope 多选列表：离线 dot(off)+非 git · 直通；未绑显示「未绑机器」+虚线 dot(none)；unknown 弱化「模式未知」", async () => {
    apiFetchMock.mockResolvedValue([
      probeItem(CURRENT_WS_ID),
      probeItem("ws-git", { daemon_name: "机器A", daemon_online: true, git_mode: "git" }),
      probeItem("ws-direct", { daemon_name: "机器B", daemon_online: false, git_mode: "direct" }),
      probeItem("ws-none", { daemon_name: null, daemon_online: false, git_mode: "unknown" }),
      probeItem("ws-unk", { daemon_name: "机器C", daemon_online: true, git_mode: "unknown" }),
    ]);
    listProjectsMock.mockResolvedValue([makeProject("p-1", "网站重构项目")]);
    listProjectWorkspacesMock.mockResolvedValue([
      makeWs("ws-git", "sillyspec", "backend-code"),
      makeWs("ws-direct", "设计稿共享盘", "docs"),
      makeWs("ws-none", "未绑盘", "docs"),
      makeWs("ws-unk", "未知盘", "docs"),
    ]);
    setup();

    fireEvent.click(screen.getByRole("radio", { name: /项目维度/ }));
    fireEvent.change(await screen.findByLabelText(/选择项目/), {
      target: { value: "p-1" },
    });
    await screen.findByText("sillyspec");

    // 在线 git 行（场景①）；当前工作区卡（fixture 同为 git）也带同标签 → 共 2 处。
    expect(await screen.findByText("机器A · 在线")).toBeInTheDocument();
    expect(screen.getAllByText("git 隔离")).toHaveLength(2);
    expect(screen.getByTestId("probe-dot-ws-git").getAttribute("data-state")).toBe("on");
    // 离线 direct 行。
    expect(screen.getByText("机器B · 离线")).toBeInTheDocument();
    expect(screen.getByText("非 git · 直通")).toBeInTheDocument();
    expect(screen.getByTestId("probe-dot-ws-direct").getAttribute("data-state")).toBe("off");
    // 未绑：未绑机器 + 虚线 dot（原型 .dot.none）。
    expect(screen.getByText("未绑机器")).toBeInTheDocument();
    expect(screen.getByTestId("probe-dot-ws-none").getAttribute("data-state")).toBe("none");
    // git_mode=unknown：弱化「模式未知」（未绑盘与未知盘两行均为 unknown）。
    expect(screen.getByText("机器C · 在线")).toBeInTheDocument();
    expect(screen.getAllByText("模式未知")).toHaveLength(2);
  });
});

/* ───────────────── 10. task-12：主 agent（项目经理）选择器（preSession，场景③） ───────────────── */

describe("TeamTriggerPopover 主 agent 选择器（preSession）", () => {
  function setupPreSession() {
    apiFetchMock.mockResolvedValue([
      probeItem(CURRENT_WS_ID, { daemon_name: "主机器" }),
      probeItem("ws-on", { daemon_name: "在线机器", daemon_online: true }),
      probeItem("ws-off", { daemon_name: "离线机器", daemon_online: false }),
      probeItem("ws-none", { daemon_name: null, daemon_online: false }),
    ]);
    listProjectsMock.mockResolvedValue([makeProject("p-1", "网站重构项目")]);
    listProjectWorkspacesMock.mockResolvedValue([
      makeWs("ws-on", "在线盘", "backend-code"),
      makeWs("ws-off", "离线盘", "docs"),
      makeWs("ws-none", "无绑盘", "docs"),
    ]);
    return setup({ preSession: true });
  }

  /** 切项目维度 → 选 p-1 → 勾选三个 scope 工作区（选择器候选就绪）。 */
  async function selectAllScope() {
    fireEvent.click(screen.getByRole("radio", { name: /项目维度/ }));
    fireEvent.change(await screen.findByLabelText(/选择项目/), {
      target: { value: "p-1" },
    });
    await screen.findByText("在线盘");
    fireEvent.click(screen.getByRole("checkbox", { name: /勾选工作区 在线盘/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /勾选工作区 离线盘/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /勾选工作区 无绑盘/ }));
    return (await screen.findByLabelText(
      /主 agent（项目经理）/,
    )) as HTMLSelectElement;
  }

  it("缺省（preSession=false）不渲染选择器", () => {
    setup();

    expect(screen.queryByLabelText(/主 agent（项目经理）/)).not.toBeInTheDocument();
  });

  it("preSession=true 渲染选择器：默认「当前会话」；scope 工作区选项带机器状态，离线/未绑 disabled（场景③）", async () => {
    setupPreSession();
    const sel = await selectAllScope();

    // 首项默认「当前会话（默认：用上方选择的机器与智能体）」且为当前值。
    expect(sel.value).toBe("");
    expect(sel.options[0]!.text).toBe("当前会话（默认：用上方选择的机器与智能体）");
    // 在线工作区可选，文案带机器名。
    expect(sel.options[1]!.text).toBe("在线盘 · 在线机器（该工作区设备与智能体）");
    expect((sel.options[1] as HTMLOptionElement).disabled).toBe(false);
    // 离线/未绑 → disabled（「机器离线」/「未绑机器」）。
    expect(sel.options[2]!.text).toBe("离线盘 · 机器离线");
    expect((sel.options[2] as HTMLOptionElement).disabled).toBe(true);
    expect(sel.options[3]!.text).toBe("无绑盘 · 未绑机器");
    expect((sel.options[3] as HTMLOptionElement).disabled).toBe(true);

    // preSession 实例确认按钮文案（原型场景③）。
    expect(
      screen.getByRole("button", { name: /派团队（随首句创建生效）/ }),
    ).toBeInTheDocument();
  });

  it("选工作区 → payload.orchestrator_workspace_id=该 id；默认「当前会话」=null", async () => {
    setupPreSession();
    const sel = await selectAllScope();

    // 默认「当前会话」→ null。
    fireEvent.click(screen.getByRole("button", { name: /派团队（随首句创建生效）/ }));
    await waitFor(() => expect(HANDLERS.onTrigger).toHaveBeenCalledTimes(1));
    expect(lastPayload().orchestrator_workspace_id).toBeNull();

    // 选「在线盘」→ 该工作区 id。
    fireEvent.change(sel, { target: { value: "ws-on" } });
    fireEvent.click(screen.getByRole("button", { name: /派团队（随首句创建生效）/ }));
    await waitFor(() => expect(HANDLERS.onTrigger).toHaveBeenCalledTimes(2));
    expect(lastPayload().orchestrator_workspace_id).toBe("ws-on");
  });

  it("取消勾选已选工作区 → 选择回落「当前会话」（payload=null）", async () => {
    setupPreSession();
    const sel = await selectAllScope();

    fireEvent.change(sel, { target: { value: "ws-on" } });
    expect(sel.value).toBe("ws-on");
    // 取消勾选在线盘 → 选项消失，选择值回落默认。
    fireEvent.click(screen.getByRole("checkbox", { name: /勾选工作区 在线盘/ }));
    await waitFor(() => expect(sel.value).toBe(""));
    fireEvent.click(screen.getByRole("button", { name: /派团队（随首句创建生效）/ }));
    await waitFor(() => expect(HANDLERS.onTrigger).toHaveBeenCalledTimes(1));
    expect(lastPayload().orchestrator_workspace_id).toBeNull();
  });

  it("非 preSession 实例：payload 不含 orchestrator_workspace_id（既有行为零变化）", async () => {
    apiFetchMock.mockResolvedValue([probeItem(CURRENT_WS_ID)]);
    listProjectsMock.mockResolvedValue([makeProject("p-1", "网站重构项目")]);
    listProjectWorkspacesMock.mockResolvedValue([makeWs("ws-on", "在线盘", "backend-code")]);
    setup();

    // 项目模式勾选工作区确认（scope 完整路径）也不带该字段。
    fireEvent.click(screen.getByRole("radio", { name: /项目维度/ }));
    fireEvent.change(await screen.findByLabelText(/选择项目/), {
      target: { value: "p-1" },
    });
    await screen.findByText("在线盘");
    fireEvent.click(screen.getByRole("checkbox", { name: /勾选工作区 在线盘/ }));
    fireEvent.click(screen.getByRole("button", { name: /就绪，随下条消息发出/ }));

    await waitFor(() => expect(HANDLERS.onTrigger).toHaveBeenCalledTimes(1));
    expect("orchestrator_workspace_id" in lastPayload()).toBe(false);
  });

  it("工作区模式（scope=当前工作区）：preSession 选择器含当前工作区选项（在线可选）", async () => {
    apiFetchMock.mockResolvedValue([
      probeItem(CURRENT_WS_ID, { daemon_name: "主机器", daemon_online: true }),
    ]);
    setup({ preSession: true });

    const sel = (await screen.findByLabelText(
      /主 agent（项目经理）/,
    )) as HTMLSelectElement;
    expect(sel.options.length).toBe(2);
    expect(sel.options[1]!.text).toBe("前端官网 · 主机器（该工作区设备与智能体）");
    expect((sel.options[1] as HTMLOptionElement).disabled).toBe(false);
  });
});

/* ───────────────── 11. task-12：probe 失败 fail-safe ───────────────── */

describe("TeamTriggerPopover probe 失败 fail-safe", () => {
  it("probe 失败 → 机器 meta 标签缺失、弹层照常可用（确认回调不受阻）", async () => {
    apiFetchMock.mockRejectedValue(new Error("probe down"));
    setup();

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // meta 缺失：无机器名/在线文案/git 模式标签。
    expect(screen.queryByText(/· 在线/)).not.toBeInTheDocument();
    expect(screen.queryByText("git 隔离")).not.toBeInTheDocument();
    expect(screen.queryByText("未绑机器")).not.toBeInTheDocument();
    // 不阻断：确认按钮可用且 payload 正常组装（不含探测字段）。
    fireEvent.click(screen.getByRole("button", { name: /就绪，随下条消息发出/ }));
    await waitFor(() => expect(HANDLERS.onTrigger).toHaveBeenCalledTimes(1));
    expect(lastPayload()).toEqual({ objective: null, budget_usd: null });
  });
});

/* ───────────────── 12. task-07 Phase 5：defaultProjectId 预选（FR-06 / D-004@v2） ───────────────── */

describe("TeamTriggerPopover defaultProjectId 预选（悬浮预会话「发起团队」入口）", () => {
  it("项目预选 + scopeMode=项目维度 + 关联工作区按 workspace_id 升序自动预选第一个（进 payload）", async () => {
    listProjectsMock.mockResolvedValue([
      makeProject("p-1", "网站重构项目"),
      makeProject("p-2", "移动端项目"),
    ]);
    // 乱序返回：按 workspace_id 字典序（D-004@v2 同键）应预选 ws-a。
    listProjectWorkspacesMock.mockResolvedValue([
      makeWs("ws-b", "平台前端", "frontend-code"),
      makeWs("ws-a", "sillyspec", "backend-code"),
    ]);
    // 悬浮预会话入口形态：会话未绑定工作区 + defaultProjectId。
    setup({ workspaceId: null, workspaceName: null, defaultProjectId: "p-1" });

    // scopeMode 预选项目维度（会话工作区选项禁用，项目 radio 选中）。
    const projectRadio = await waitFor(() =>
      screen.getByRole("radio", { name: /项目维度/ }),
    );
    expect(projectRadio).toBeChecked();

    // 项目下拉初值预选（无需用户手选）。
    const select = (await screen.findByLabelText(
      /选择项目/,
    )) as HTMLSelectElement;
    expect(select.value).toBe("p-1");

    // 关联工作区自动拉取 + 升序预选第一个（ws-a 勾选、ws-b 未勾）。
    //（预选后 anchor 胶囊同名展示，文本查询会多命中——直接对 checkbox 断言。）
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: /勾选工作区 sillyspec/ }),
      ).toBeChecked(),
    );
    expect(
      screen.getByRole("checkbox", { name: /勾选工作区 平台前端/ }),
    ).not.toBeChecked();

    // 预选随确认进 payload。
    fireEvent.click(screen.getByRole("button", { name: /就绪，随下条消息发出/ }));
    await waitFor(() => expect(HANDLERS.onTrigger).toHaveBeenCalledTimes(1));
    expect(lastPayload()).toEqual(
      expect.objectContaining({
        project_id: "p-1",
        scope_workspace_ids: ["ws-a"],
      }),
    );
  });

  it("有会话工作区时 defaultProjectId 仍预选项目维度（入口上下文优先）", async () => {
    listProjectsMock.mockResolvedValue([makeProject("p-1", "网站重构项目")]);
    listProjectWorkspacesMock.mockResolvedValue([makeWs("ws-a", "sillyspec", "backend-code")]);
    setup({ defaultProjectId: "p-1" });

    // 等项目列表加载完成后断言：入口上下文优先 → 项目维度选中（当前工作区不选）。
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /项目维度/ })).toBeChecked(),
    );
    expect(screen.getByRole("radio", { name: /当前工作区/ })).not.toBeChecked();
  });

  it("项目无关联工作区：不报错、无勾选，确认走既有「至少一个工作区」校验文案", async () => {
    listProjectsMock.mockResolvedValue([makeProject("p-1", "网站重构项目")]);
    listProjectWorkspacesMock.mockResolvedValue([]);
    setup({ workspaceId: null, workspaceName: null, defaultProjectId: "p-1" });

    expect(await screen.findByText(/该项目未关联工作区/)).toBeInTheDocument();
    // 确认按钮可用（不被预选逻辑禁用/崩溃），点击走既有校验。
    fireEvent.click(screen.getByRole("button", { name: /就绪，随下条消息发出/ }));
    expect(
      await screen.findByText(/勾选至少一个工作区/),
    ).toBeInTheDocument();
    expect(HANDLERS.onTrigger).not.toHaveBeenCalled();
  });

  it("预选一次后改选其它项目 → 不再自动预选（scope 空选走原逻辑）", async () => {
    listProjectsMock.mockResolvedValue([
      makeProject("p-1", "网站重构项目"),
      makeProject("p-2", "移动端项目"),
    ]);
    listProjectWorkspacesMock.mockImplementation(async (projectId: string) =>
      projectId === "p-1"
        ? [makeWs("ws-a", "sillyspec", "backend-code")]
        : [makeWs("ws-c", "共享文档盘", "docs")],
    );
    setup({ workspaceId: null, workspaceName: null, defaultProjectId: "p-1" });

    // p-1 预选完成（waitFor 勾选态——预选 effect 在列表渲染后一拍生效）。
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: /勾选工作区 sillyspec/ }),
      ).toBeChecked(),
    );

    // 改选 p-2：工作区列表换新，不自动勾选（预选仅消费一次）。
    fireEvent.change(screen.getByLabelText(/选择项目/), {
      target: { value: "p-2" },
    });
    expect(await screen.findByText("共享文档盘")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /勾选工作区 共享文档盘/ }),
    ).not.toBeChecked();
  });
});
