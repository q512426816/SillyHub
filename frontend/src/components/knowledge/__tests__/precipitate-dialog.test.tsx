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
}));
vi.mock("@/lib/knowledge", () => ({
  proposeKnowledge: knowledgeApi.proposeKnowledge,
  dispatchDistill: knowledgeApi.dispatchDistill,
}));

const sessionApi = vi.hoisted(() => ({ listAgentSessions: vi.fn() }));
vi.mock("@/lib/daemon/session-lists", () => ({
  listAgentSessions: sessionApi.listAgentSessions,
}));

const changesApi = vi.hoisted(() => ({ listChanges: vi.fn() }));
vi.mock("@/lib/changes", () => ({
  listChanges: changesApi.listChanges,
}));

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

function renderDialog(
  overrides: Partial<{
    onProposed: () => void;
    onClose: () => void;
    onDistilled: () => void;
  }> = {},
) {
  return render(
    <PrecipitateDialog
      workspaceId="ws-1"
      onProposed={overrides.onProposed ?? (() => {})}
      onClose={overrides.onClose ?? (() => {})}
      onDistilled={overrides.onDistilled}
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

    // 未选源 → 「派发提炼任务」禁用。
    expect(screen.getByRole("button", { name: "派发提炼任务" })).toBeDisabled();
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

    // 切换来源类型清空已选源（派发仍禁用直到重新选择）。
    expect(screen.getByRole("button", { name: "派发提炼任务" })).toBeDisabled();

    fireEvent.click(screen.getByTestId("distill-source-type-session"));
    await waitFor(() =>
      expect(screen.getByText("fix(mobile): 群聊手机端样式四修")).toBeInTheDocument(),
    );
  });

  it("选中源后派发成功 → dispatchDistill 载荷含 source_type/source_ref（focus 缺省 null）+ toast + onDistilled + onClose", async () => {
    const onDistilled = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onDistilled, onClose });

    const items = await screen.findAllByTestId("distill-source-item");
    fireEvent.click(items[0]!);
    expect(screen.getByRole("button", { name: "派发提炼任务" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "派发提炼任务" }));

    await waitFor(() => expect(knowledgeApi.dispatchDistill).toHaveBeenCalledTimes(1));
    expect(knowledgeApi.dispatchDistill).toHaveBeenCalledWith("ws-1", {
      source_type: "session",
      source_ref: SESSION_ID,
      focus: null,
    });
    expect(notify.success).toHaveBeenCalledWith("已派发提炼任务，完成后进入待审核");
    expect(onDistilled).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("填写关注点随载荷透传（trim）；变更源派发载荷 source_type=change + change_key", async () => {
    renderDialog();

    fireEvent.click(screen.getByTestId("distill-source-type-change"));
    const changeItems = await screen.findAllByTestId("distill-source-item");
    fireEvent.click(changeItems[0]!);
    fireEvent.change(screen.getByLabelText("提炼关注点"), {
      target: { value: "  只提取踩坑与解法  " },
    });

    fireEvent.click(screen.getByRole("button", { name: "派发提炼任务" }));

    await waitFor(() => expect(knowledgeApi.dispatchDistill).toHaveBeenCalledTimes(1));
    expect(knowledgeApi.dispatchDistill).toHaveBeenCalledWith("ws-1", {
      source_type: "change",
      source_ref: CHANGE_KEY,
      focus: "只提取踩坑与解法",
    });
  });

  it("派发失败 → 展示错误信息，弹层不关闭、onDistilled 不触发", async () => {
    knowledgeApi.dispatchDistill.mockRejectedValueOnce(new Error("该会话还没有对话记录，无内容可提炼。"));
    const onDistilled = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onDistilled, onClose });

    const items = await screen.findAllByTestId("distill-source-item");
    fireEvent.click(items[0]!);
    fireEvent.click(screen.getByRole("button", { name: "派发提炼任务" }));

    await waitFor(() =>
      expect(screen.getByText(/该会话还没有对话记录/)).toBeInTheDocument(),
    );
    expect(onDistilled).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // 失败后按钮回到可用（非 dispatching 卡死）。
    expect(screen.getByRole("button", { name: "派发提炼任务" })).toBeEnabled();
  });

  it("源列表加载失败 → 错误文案展示，派发按钮保持禁用", async () => {
    sessionApi.listAgentSessions.mockRejectedValueOnce(new Error("网络连接失败，请检查网络后重试"));
    renderDialog();

    await waitFor(() =>
      expect(screen.getByText(/网络连接失败/)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("distill-source-item")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "派发提炼任务" })).toBeDisabled();
  });
});
