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
// 测试纪律：FIRST / AAA / 仅 mock 网络层（@/lib/ppm/project listProjects +
// @/lib/workspace listProjectWorkspaces）；组件纯受控（onTrigger/onClose 回调），
// API 调用归 session-panel（父层）。组件不用 antd（对齐段族惯例，规避中文
// autoLetterSpacing 拆分坑），getByText/getByRole 直接可用。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { TeamTriggerPopover } from "../team-trigger-popover";
import { listProjects } from "@/lib/ppm/project";
import { listProjectWorkspaces } from "@/lib/workspace";
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

const listProjectsMock = vi.mocked(listProjects);
const listProjectWorkspacesMock = vi.mocked(listProjectWorkspaces);

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

/** last payload（断言便捷）。 */
function lastPayload(): TeamMissionTriggerRequest {
  const calls = HANDLERS.onTrigger.mock.calls;
  return calls[calls.length - 1]![0] as TeamMissionTriggerRequest;
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
