/**
 * PrecipitateDialog 单测（task-05 / 2026-09-17-knowledge-precipitation / FR-02；
 * task-08 同变更补「从记录提炼」tab 落地用例并翻转默认 tab）。
 *
 * 依据：
 *   - frontend/src/components/knowledge/precipitate-dialog.tsx（对照原型 precipitateModal）
 *   - 变更 design Wave 4 前端整合 + task-05 卡片（必填缺省禁用提交 / 分类默认值 /
 *     保存成功失败分支）+ task-08 卡片（来源类型切换 / 源列表渲染 / 派发载荷
 *     source_type+source_ref+focus / 未选源禁用；task-05 头注释约定 task-08
 *     落地后默认 tab 翻转为「从记录提炼」，原型同款）
 *
 * 覆盖：
 *   1. 手工录入：必填缺省 → 「存为候选知识」禁用；填齐后可用
 *   2. 分类默认值 uncategorized；切换分类随提交体透传
 *   3. 提交成功 → proposeKnowledge(ws, {title, category, body}) + onProposed + onClose
 *   4. 提交失败 → 错误信息展示、弹层不关闭、onProposed 不触发
 *   5. 从记录提炼（task-08）：默认 tab 翻转；会话源列表来自 listAgentSessions
 *      （workspace_id 过滤）；切「变更归档」→ listChanges(status=archived) 渲染
 *      变更名；未选源派发禁用；派发成功载荷 source_type/source_ref/focus +
 *      toast + onDistilled + onClose；派发失败错误展示弹层不关
 *
 * mock @/lib/knowledge + @/lib/daemon/session-lists + @/lib/changes（hoisted
 * vi.fn）+ @/lib/errors useNotify（antd App 上下文依赖，workspace-scan-dialog.test
 * 同款替换纯函数实现）。
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PrecipitateDialog } from "@/components/knowledge/precipitate-dialog";

const knowledgeApi = vi.hoisted(() => ({
  proposeKnowledge: vi.fn(),
  dispatchDistill: vi.fn(),
  listQuicklog: vi.fn(),
  listDistillTasks: vi.fn(),
}));
vi.mock("@/lib/knowledge", () => ({
  proposeKnowledge: knowledgeApi.proposeKnowledge,
  dispatchDistill: knowledgeApi.dispatchDistill,
  listQuicklog: knowledgeApi.listQuicklog,
  listDistillTasks: knowledgeApi.listDistillTasks,
}));

const sessionApi = vi.hoisted(() => ({ listAgentSessions: vi.fn() }));
vi.mock("@/lib/daemon/session-lists", () => ({
  listAgentSessions: sessionApi.listAgentSessions,
}));

const changesApi = vi.hoisted(() => ({ listChanges: vi.fn() }));
vi.mock("@/lib/changes", () => ({
  listChanges: changesApi.listChanges,
}));

// D-010③ fresh 配置数据源：listDaemonRuntimes 换 mock，PROVIDER_META 保留真实实现。
const daemonApi = vi.hoisted(() => ({ listDaemonRuntimes: vi.fn() }));
vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return { ...actual, listDaemonRuntimes: daemonApi.listDaemonRuntimes };
});

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
// useNotify 依赖 antd App 上下文，这里直接换纯函数实现（workspace-scan-dialog.test 先例）。
vi.mock("@/lib/errors", async () => {
  const actual = await vi.importActual<typeof import("@/lib/errors")>("@/lib/errors");
  return { ...actual, useNotify: () => notify };
});

const SESSION_ID = "9a8b7c6d-1111-2222-3333-444455556666";
const CHANGE_KEY = "2026-09-04-conflict-resolve-entry";
const QUICK_REF_A = "ql-20260917-001-a1b2";
const QUICK_REF_B = "ql-20260917-002-c3d4";

/** 提炼 tab 默认激活 → 反链/机器列表随同拉取，提供静默缺省。 */
function mockDistillSideData() {
  knowledgeApi.listDistillTasks.mockResolvedValue([]);
  daemonApi.listDaemonRuntimes.mockResolvedValue([]);
}

function renderDialog(
  overrides: Partial<{
    onProposed: () => void;
    onClose: () => void;
    onDistilled: () => void;
    onJumpToKnowledge: (filename: string) => void;
  }> = {},
) {
  return render(
    <PrecipitateDialog
      workspaceId="ws-1"
      onProposed={overrides.onProposed ?? (() => {})}
      onClose={overrides.onClose ?? (() => {})}
      onDistilled={overrides.onDistilled}
      onJumpToKnowledge={overrides.onJumpToKnowledge}
    />,
  );
}

/** 切到手工录入 tab（task-08 起默认 tab 为「从记录提炼」）。 */
function switchToManual() {
  fireEvent.click(screen.getByRole("tab", { name: "手工录入" }));
}

function fillManualForm(title: string, body: string) {
  fireEvent.change(screen.getByLabelText(/^标题/), { target: { value: title } });
  fireEvent.change(screen.getByLabelText(/^正文/), { target: { value: body } });
}

/** 会话源 fixture（组件只读 id/title/turn_count，其余字段给宽松占位）。 */
function sessionItem(p: Partial<Record<string, unknown>> & { id: string }) {
  return {
    provider: "claude",
    status: "ended",
    turn_count: 12,
    mode: null,
    created_at: "2026-09-17T09:00:00Z",
    last_active_at: null,
    title: null,
    config: null,
    config_snapshot: null,
    ...p,
  };
}

/** 变更源 fixture（组件只读 change_key/title）。 */
function changeItem(p: Partial<Record<string, unknown>> & { change_key: string }) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    title: null,
    status: "archived",
    location: "repo",
    change_type: null,
    affected_components: [],
    owner_id: null,
    updated_at: "2026-09-17T09:00:00Z",
    ...p,
  };
}

beforeEach(() => {
  knowledgeApi.proposeKnowledge.mockReset();
  knowledgeApi.proposeKnowledge.mockResolvedValue({
    zone: "proposed",
    filename: "proposed/demo.md",
    path: ".sillyspec/knowledge/proposed/demo.md",
    title: "demo",
    content: null,
    last_modified_at: null,
  });
  knowledgeApi.dispatchDistill.mockReset();
  knowledgeApi.dispatchDistill.mockResolvedValue({
    agent_run_id: "11111111-1111-1111-1111-111111111111",
    source_type: "session",
    source_ref: SESSION_ID,
    status: "pending",
    created_at: "2026-09-17T10:00:00Z",
    mode: "resume",
  });
  sessionApi.listAgentSessions.mockReset();
  sessionApi.listAgentSessions.mockResolvedValue({
    items: [
      sessionItem({ id: SESSION_ID, title: "fix(mobile): 群聊手机端样式四修", turn_count: 263 }),
      sessionItem({ id: "22222222-2222-2222-2222-222222222222", title: null, turn_count: 98 }),
    ],
    total: 2,
    limit: 50,
    offset: 0,
  });
  changesApi.listChanges.mockReset();
  changesApi.listChanges.mockResolvedValue({
    items: [changeItem({ change_key: CHANGE_KEY, title: "feat(mobile): 变更中心与 PC 端功能对齐" })],
    total: 1,
    limit: 50,
    offset: 0,
  });
  knowledgeApi.listQuicklog.mockReset();
  knowledgeApi.listQuicklog.mockResolvedValue({
    items: [
      {
        filename: `${QUICK_REF_A}.md`,
        path: `.sillyspec/quicklog/${QUICK_REF_A}.md`,
        title: "会话列表心跳三缺陷",
        content: null,
        last_modified_at: "2026-09-17T08:00:00Z",
      },
      {
        filename: `${QUICK_REF_B}.md`,
        path: `.sillyspec/quicklog/${QUICK_REF_B}.md`,
        title: null,
        content: null,
        last_modified_at: null,
      },
    ],
    total: 2,
  });
  knowledgeApi.listDistillTasks.mockReset();
  daemonApi.listDaemonRuntimes.mockReset();
  mockDistillSideData();
});

afterEach(() => {
  cleanup();
});

describe("PrecipitateDialog · 手工录入 tab（task-05）", () => {
  it("默认落在「从记录提炼」tab（task-08 翻转）；切到手工录入后必填缺省 → 提交禁用，填齐后可用", () => {
    renderDialog();

    // 双 tab 骨架齐全；默认激活 tab 已翻转为「从记录提炼」（task-05 头注释约定）。
    expect(screen.getByRole("tab", { name: "从记录提炼" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "手工录入" })).toBeInTheDocument();
    expect(screen.queryByTestId("distill-tab-placeholder")).not.toBeInTheDocument();

    switchToManual();
    expect(screen.getByRole("tab", { name: "手工录入" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const submit = screen.getByRole("button", { name: "存为候选知识" });
    expect(submit).toBeDisabled();

    // 只填标题仍禁用（正文必填）
    fireEvent.change(screen.getByLabelText(/^标题/), { target: { value: "只有标题" } });
    expect(submit).toBeDisabled();
    // 标题清空、只填正文仍禁用
    fireEvent.change(screen.getByLabelText(/^标题/), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/^正文/), { target: { value: "正文" } });
    expect(submit).toBeDisabled();

    fillManualForm("码页乱码", "## 问题\nGBK 控制台");
    expect(submit).toBeEnabled();
  });

  it("分类默认「未分类」（uncategorized）；切换分类随提交体透传", async () => {
    renderDialog();
    switchToManual();

    const category = screen.getByLabelText("分类") as HTMLSelectElement;
    expect(category.value).toBe("uncategorized");

    fillManualForm("码页乱码", "正文");
    fireEvent.change(category, { target: { value: "known-issues" } });
    fireEvent.click(screen.getByRole("button", { name: "存为候选知识" }));

    await waitFor(() => expect(knowledgeApi.proposeKnowledge).toHaveBeenCalledTimes(1));
    expect(knowledgeApi.proposeKnowledge).toHaveBeenCalledWith("ws-1", {
      title: "码页乱码",
      category: "known-issues",
      body: "正文",
    });
  });

  it("提交成功 → onProposed 刷新 + onClose 关弹层 + 成功 toast", async () => {
    const onProposed = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onProposed, onClose });
    switchToManual();
    fillManualForm("码页乱码", "## 问题\nGBK");

    fireEvent.click(screen.getByRole("button", { name: "存为候选知识" }));

    await waitFor(() => expect(onProposed).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(notify.success).toHaveBeenCalledWith("已存为候选知识，进入待审核区");
    // 标题 trim 后提交
    expect(knowledgeApi.proposeKnowledge).toHaveBeenCalledWith("ws-1", {
      title: "码页乱码",
      category: "uncategorized",
      body: "## 问题\nGBK",
    });
  });

  it("提交失败 → 展示错误信息，弹层不关闭、onProposed 不触发", async () => {
    knowledgeApi.proposeKnowledge.mockRejectedValueOnce(new Error("文件在别处被修改，请刷新后重试"));
    const onProposed = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onProposed, onClose });
    switchToManual();
    fillManualForm("码页乱码", "正文");

    fireEvent.click(screen.getByRole("button", { name: "存为候选知识" }));

    await waitFor(() =>
      expect(screen.getByText(/文件在别处被修改/)).toBeInTheDocument(),
    );
    expect(onProposed).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // 失败后按钮回到可用（非 submitting 卡死）
    expect(screen.getByRole("button", { name: "存为候选知识" })).toBeEnabled();
  });
});

describe("PrecipitateDialog · 从记录提炼 tab（task-08 / FR-01 / FR-03）", () => {
  it("默认 tab 即从记录提炼：拉会话列表（workspace_id 过滤）并渲染标题与条数；未选源派发禁用", async () => {
    renderDialog();

    // 会话源列表来自 listAgentSessions（实名 API，workspace_id 过滤当前工作区）。
    await waitFor(() => expect(sessionApi.listAgentSessions).toHaveBeenCalledTimes(1));
    expect(sessionApi.listAgentSessions).toHaveBeenCalledWith({
      workspace_id: "ws-1",
      limit: 50,
    });

    const items = await screen.findAllByTestId("distill-source-item");
    expect(items).toHaveLength(2);
    expect(screen.getByText("fix(mobile): 群聊手机端样式四修")).toBeInTheDocument();
    expect(screen.getByText("263 条记录")).toBeInTheDocument();
    // title 缺失兜底到「会话 <id 前 8 位>」。
    expect(screen.getByText("会话 22222222")).toBeInTheDocument();

    // 未选源 → 「续接原会话提炼」禁用（会话源默认 resume，D-009 推荐项）。
    expect(screen.getByRole("button", { name: "续接原会话提炼" })).toBeDisabled();
  });

  it("切「变更归档」→ listChanges(status=archived) 渲染变更名；切回会话记录回到会话列表", async () => {
    renderDialog();
    await screen.findAllByTestId("distill-source-item");

    fireEvent.click(screen.getByTestId("distill-source-type-change"));

    await waitFor(() => expect(changesApi.listChanges).toHaveBeenCalledWith("ws-1", {
      status: "archived",
      pageSize: 50,
    }));
    const items = await screen.findAllByTestId("distill-source-item");
    expect(items).toHaveLength(1);
    expect(screen.getByText("feat(mobile): 变更中心与 PC 端功能对齐")).toBeInTheDocument();
    expect(screen.getByText("已归档变更")).toBeInTheDocument();

    // 切换来源类型清空已选源（派发仍禁用直到重新选择）；变更源强制 fresh，
    // 按钮文案为「新建 agent 提炼」。
    expect(screen.getByRole("button", { name: "新建 agent 提炼" })).toBeDisabled();

    fireEvent.click(screen.getByTestId("distill-source-type-session"));
    await waitFor(() =>
      expect(screen.getByText("fix(mobile): 群聊手机端样式四修")).toBeInTheDocument(),
    );
  });

  it("选中源后派发成功 → 载荷含 source_type/source_ref/mode=resume（会话默认续接）+ toast + onDistilled + onClose", async () => {
    const onDistilled = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onDistilled, onClose });

    const items = await screen.findAllByTestId("distill-source-item");
    fireEvent.click(items[0]!);
    expect(screen.getByRole("button", { name: "续接原会话提炼" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "续接原会话提炼" }));

    await waitFor(() => expect(knowledgeApi.dispatchDistill).toHaveBeenCalledTimes(1));
    expect(knowledgeApi.dispatchDistill).toHaveBeenCalledWith("ws-1", {
      source_type: "session",
      source_ref: SESSION_ID,
      focus: null,
      mode: "resume",
    });
    expect(notify.success).toHaveBeenCalledWith("已派发提炼任务，完成后进入待审核");
    expect(onDistilled).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("填写关注点随载荷透传（trim）；变更源派发载荷 source_type=change + change_key + 强制 mode=fresh", async () => {
    renderDialog();

    fireEvent.click(screen.getByTestId("distill-source-type-change"));
    const changeItems = await screen.findAllByTestId("distill-source-item");
    fireEvent.click(changeItems[0]!);
    fireEvent.change(screen.getByLabelText("提炼关注点"), {
      target: { value: "  只提取踩坑与解法  " },
    });

    fireEvent.click(screen.getByRole("button", { name: "新建 agent 提炼" }));

    await waitFor(() => expect(knowledgeApi.dispatchDistill).toHaveBeenCalledTimes(1));
    expect(knowledgeApi.dispatchDistill).toHaveBeenCalledWith("ws-1", {
      source_type: "change",
      source_ref: CHANGE_KEY,
      focus: "只提取踩坑与解法",
      mode: "fresh",
    });
  });

  it("派发失败 → 展示错误信息，弹层不关闭、onDistilled 不触发", async () => {
    knowledgeApi.dispatchDistill.mockRejectedValueOnce(new Error("该会话还没有对话记录，无内容可提炼。"));
    const onDistilled = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onDistilled, onClose });

    const items = await screen.findAllByTestId("distill-source-item");
    fireEvent.click(items[0]!);
    fireEvent.click(screen.getByRole("button", { name: "续接原会话提炼" }));

    await waitFor(() =>
      expect(screen.getByText(/该会话还没有对话记录/)).toBeInTheDocument(),
    );
    expect(onDistilled).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // 失败后按钮回到可用（非 dispatching 卡死）。
    expect(screen.getByRole("button", { name: "续接原会话提炼" })).toBeEnabled();
  });

  it("源列表加载失败 → 错误文案展示，派发按钮保持禁用", async () => {
    sessionApi.listAgentSessions.mockRejectedValueOnce(new Error("网络连接失败，请检查网络后重试"));
    renderDialog();

    await waitFor(() =>
      expect(screen.getByText(/网络连接失败/)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("distill-source-item")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "续接原会话提炼" })).toBeDisabled();
  });
});

describe("PrecipitateDialog · D-010 快速修复多选 + D-009 派谁去干", () => {
  it("切「快速修复」→ listQuicklog 拉取；checkbox 多选两条 → 载荷 source_ref 为 list + 强制 mode=fresh", async () => {
    renderDialog();

    fireEvent.click(screen.getByTestId("distill-source-type-quick"));

    await waitFor(() => expect(knowledgeApi.listQuicklog).toHaveBeenCalledWith("ws-1"));
    const items = await screen.findAllByTestId("distill-source-item");
    expect(items).toHaveLength(2);
    // ql 标题展示（title 缺失回退 filename）；source_ref 为 filename 去 .md 的自然键。
    expect(screen.getByText("会话列表心跳三缺陷")).toBeInTheDocument();
    expect(screen.getByText(`${QUICK_REF_B}.md`)).toBeInTheDocument();

    // 多选两条（对应 source_ref list[str]，D-010②）。
    fireEvent.click(items[0]!);
    fireEvent.click(items[1]!);
    expect(screen.getByRole("button", { name: "新建 agent 提炼" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "新建 agent 提炼" }));

    await waitFor(() => expect(knowledgeApi.dispatchDistill).toHaveBeenCalledTimes(1));
    expect(knowledgeApi.dispatchDistill).toHaveBeenCalledWith("ws-1", {
      source_type: "quick",
      source_ref: [QUICK_REF_A, QUICK_REF_B],
      focus: null,
      mode: "fresh",
    });
  });

  it("快速修复未选任何条 → 派发禁用；单选一条也可派发（list 单元素形态）", async () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("distill-source-type-quick"));
    const items = await screen.findAllByTestId("distill-source-item");

    expect(screen.getByRole("button", { name: "新建 agent 提炼" })).toBeDisabled();

    fireEvent.click(items[0]!);
    fireEvent.click(screen.getByRole("button", { name: "新建 agent 提炼" }));
    await waitFor(() => expect(knowledgeApi.dispatchDistill).toHaveBeenCalledTimes(1));
    expect(knowledgeApi.dispatchDistill).toHaveBeenCalledWith("ws-1", {
      source_type: "quick",
      source_ref: [QUICK_REF_A],
      focus: null,
      mode: "fresh",
    });
  });

  it("会话源默认 resume（推荐徽标）；变更/快速修复 resume 选项禁用并提示无原会话概念", async () => {
    renderDialog();
    await screen.findAllByTestId("distill-source-item");

    // 会话源：resume 可选且带推荐徽标；fresh 配置区缺省隐藏。
    expect(screen.getByText("推荐")).toBeInTheDocument();
    expect(screen.getByLabelText("原会话续接")).toBeEnabled();
    expect(screen.queryByLabelText("机器（runtime）")).not.toBeInTheDocument();

    // 变更源：resume 禁用 + 提示；fresh 配置区强制展开。
    fireEvent.click(screen.getByTestId("distill-source-type-change"));
    await screen.findAllByTestId("distill-source-item");
    expect(screen.getByLabelText("原会话续接")).toBeDisabled();
    expect(screen.getByText(/变更归档没有「原会话」概念/)).toBeInTheDocument();
    expect(screen.getByLabelText("机器（runtime）")).toBeInTheDocument();
    expect(screen.getByLabelText("agent 类型")).toBeInTheDocument();

    // 快速修复源：同样强制 fresh，提示文案为快速修复口径。
    fireEvent.click(screen.getByTestId("distill-source-type-quick"));
    await screen.findAllByTestId("distill-source-item");
    expect(screen.getByLabelText("原会话续接")).toBeDisabled();
    expect(screen.getByText(/快速修复是零散记录/)).toBeInTheDocument();
  });

  it("会话源切 fresh → 配置区展开；选定机器+agent 类型随载荷下发（runtime_id/agent_type）", async () => {
    daemonApi.listDaemonRuntimes.mockResolvedValue([
      {
        id: "rt-1",
        name: "DESKTOP-HJ0AM09",
        display_alias: "本机",
        provider: "claude",
        status: "online",
      },
      {
        id: "rt-2",
        name: "runtime-prod-01",
        display_alias: null,
        provider: "codex",
        status: "online",
      },
    ]);
    renderDialog();
    const items = await screen.findAllByTestId("distill-source-item");
    fireEvent.click(items[0]!);

    // 默认 resume → 无配置区；切 fresh → 机器/agent 类型下拉出现（在线 runtime 同源）。
    expect(screen.queryByLabelText("机器（runtime）")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("新建 agent"));
    const runtimeSelect = await screen.findByLabelText("机器（runtime）");
    expect(screen.getByLabelText("agent 类型")).toBeInTheDocument();

    fireEvent.change(runtimeSelect, { target: { value: "rt-1" } });
    fireEvent.change(screen.getByLabelText("agent 类型"), { target: { value: "claude" } });

    fireEvent.click(screen.getByRole("button", { name: "新建 agent 提炼" }));
    await waitFor(() => expect(knowledgeApi.dispatchDistill).toHaveBeenCalledTimes(1));
    expect(knowledgeApi.dispatchDistill).toHaveBeenCalledWith("ws-1", {
      source_type: "session",
      source_ref: SESSION_ID,
      focus: null,
      mode: "fresh",
      runtime_id: "rt-1",
      agent_type: "claude",
    });
  });

  it("已沉淀反链（D-010①）：命中已合并任务 → 「已沉淀 ↗」点击跳 merged_to 文件段 + 关弹层", async () => {
    knowledgeApi.listDistillTasks.mockResolvedValue([
      {
        agent_run_id: "11111111-1111-1111-1111-111111111111",
        source_type: "session",
        source_ref: SESSION_ID,
        status: "completed",
        created_at: "2026-09-17T10:00:00Z",
        mode: "fresh",
        merged_to: "known-issues.md#Windows 控制台码页导致日志乱码",
        degraded_reason: null,
      },
    ]);
    const onJumpToKnowledge = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onJumpToKnowledge, onClose });
    await screen.findAllByTestId("distill-source-item");

    const badge = screen.getByTestId("distill-precipitated-badge");
    expect(badge).toHaveTextContent("已沉淀 ↗");
    fireEvent.click(badge);

    // 双键取文件段跳转，弹层关闭（merged_to 双键防锚点漂移，D-010①）。
    expect(onJumpToKnowledge).toHaveBeenCalledWith("known-issues.md");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("已沉淀反链：proposed 候选（无 merged_to）点击仅关弹层回知识库页，不触发跳转", async () => {
    knowledgeApi.listDistillTasks.mockResolvedValue([
      {
        agent_run_id: "11111111-1111-1111-1111-111111111111",
        source_type: "session",
        source_ref: SESSION_ID,
        status: "completed",
        created_at: "2026-09-17T10:00:00Z",
        mode: "resume",
        merged_to: null,
        degraded_reason: null,
      },
    ]);
    const onJumpToKnowledge = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onJumpToKnowledge, onClose });
    await screen.findAllByTestId("distill-source-item");

    fireEvent.click(screen.getByTestId("distill-precipitated-badge"));
    expect(onJumpToKnowledge).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("已沉淀反链：quick 多选任务 source_ref 为 list 投影，成员命中即打标", async () => {
    knowledgeApi.listDistillTasks.mockResolvedValue([
      {
        agent_run_id: "11111111-1111-1111-1111-111111111111",
        source_type: "quick",
        source_ref: JSON.stringify([QUICK_REF_B]),
        status: "completed",
        created_at: "2026-09-17T10:00:00Z",
        mode: "fresh",
        merged_to: "known-issues.md#心跳三缺陷",
        degraded_reason: null,
      },
    ]);
    renderDialog();
    fireEvent.click(screen.getByTestId("distill-source-type-quick"));
    await screen.findAllByTestId("distill-source-item");

    const badges = screen.getAllByTestId("distill-precipitated-badge");
    expect(badges).toHaveLength(1);
  });
});
