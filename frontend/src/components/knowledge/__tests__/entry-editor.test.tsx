/**
 * EntryEditor 单测（task-05 / 2026-09-17-knowledge-precipitation / FR-07 / D-006@v1）。
 *
 * 依据：
 *   - frontend/src/components/knowledge/entry-editor.tsx（对照原型 editEntry 编辑态）
 *   - lib/knowledge.ts updateKnowledge 契约：整文件正文替换（含 frontmatter）
 *
 * 覆盖：
 *   1. 编辑保存：textarea 改正文 → updateKnowledge 提交体 = 原 frontmatter 段
 *      原样拼回 + 新正文（frontmatter 字节不动）；成功后 onSaved 上抛服务端新正文
 *   2. 无 frontmatter 文件：提交体 = 正文原样（无拼接）
 *   3. 取消：不调 updateKnowledge、onCancel 触发（编辑不落盘）
 *   4. decisions 只读（D-006）：标注「由归档流程维护 · 只读」、textarea readOnly、
 *      无保存/取消入口
 *
 * mock @/lib/knowledge（hoisted vi.fn）+ @/lib/errors useNotify（antd App 上下文
 * 依赖，workspace-scan-dialog.test 同款替换纯函数实现）。
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EntryEditor } from "@/components/knowledge/entry-editor";

const knowledgeApi = vi.hoisted(() => ({ updateKnowledge: vi.fn() }));
vi.mock("@/lib/knowledge", () => ({
  updateKnowledge: knowledgeApi.updateKnowledge,
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

const FM_CONTENT = "---\nauthor: qinyi\nsource: manual\n---\n\n# 候选标题\n\n## 问题\n旧正文\n";

function renderEditor(overrides: Partial<{
  filename: string;
  zone: string;
  content: string;
  onSaved: (_newContent: string) => void;
  onCancel: () => void;
}> = {}) {
  return render(
    <EntryEditor
      workspaceId="ws-1"
      filename={overrides.filename ?? "proposed/pending-fix.md"}
      zone={overrides.zone ?? "proposed"}
      content={overrides.content ?? FM_CONTENT}
      onSaved={overrides.onSaved ?? (() => {})}
      onCancel={overrides.onCancel ?? (() => {})}
    />,
  );
}

beforeEach(() => {
  knowledgeApi.updateKnowledge.mockReset();
  knowledgeApi.updateKnowledge.mockResolvedValue({
    zone: "proposed",
    filename: "proposed/pending-fix.md",
    path: ".sillyspec/knowledge/proposed/pending-fix.md",
    title: "候选标题",
    content: "---\nauthor: qinyi\nsource: manual\n---\n\n# 候选标题\n\n## 问题\n新正文\n",
    last_modified_at: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("EntryEditor · 编辑保存（frontmatter 不动）", () => {
  it("frontmatter 原样展示且不入编辑框；保存提交体 = frontmatter 原样拼回 + 新正文", async () => {
    const onSaved = vi.fn();
    renderEditor({ onSaved });

    const textarea = screen.getByLabelText("正文编辑") as HTMLTextAreaElement;
    // 编辑框只含正文（frontmatter 段与首个空行剥除）
    expect(textarea.value).toBe("# 候选标题\n\n## 问题\n旧正文\n");
    // frontmatter 段以只读 pre 展示（不可编辑）
    expect(screen.getByText(/author: qinyi/)).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: "# 候选标题\n\n## 问题\n新正文\n" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(knowledgeApi.updateKnowledge).toHaveBeenCalledTimes(1));
    // 整文件正文替换契约：frontmatter 字节不动 + 编辑后正文
    expect(knowledgeApi.updateKnowledge).toHaveBeenCalledWith("ws-1", "proposed/pending-fix.md", {
      content: "---\nauthor: qinyi\nsource: manual\n---\n# 候选标题\n\n## 问题\n新正文\n",
    });
    // 成功后 onSaved 上抛服务端回传的新正文（父级回显 + 刷新列表）
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledWith(
      "---\nauthor: qinyi\nsource: manual\n---\n\n# 候选标题\n\n## 问题\n新正文\n",
    );
    expect(notify.success).toHaveBeenCalledWith("已保存（版本 +1，旧内容已备份）");
  });

  it("无 frontmatter 文件：提交体 = 正文原样", async () => {
    renderEditor({ content: "# 顶层手册\n\n正文\n" });

    fireEvent.change(screen.getByLabelText("正文编辑"), {
      target: { value: "# 顶层手册\n\n改后正文\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(knowledgeApi.updateKnowledge).toHaveBeenCalledTimes(1));
    expect(knowledgeApi.updateKnowledge).toHaveBeenCalledWith("ws-1", "proposed/pending-fix.md", {
      content: "# 顶层手册\n\n改后正文\n",
    });
  });

  it("保存失败 → 错误信息展示、onSaved 不触发、按钮回到可用", async () => {
    knowledgeApi.updateKnowledge.mockRejectedValueOnce(new Error("文件在别处被修改，请刷新后重试"));
    const onSaved = vi.fn();
    renderEditor({ onSaved });

    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(screen.getByText(/文件在别处被修改/)).toBeInTheDocument());
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存修改" })).toBeEnabled();
  });
});

describe("EntryEditor · 取消", () => {
  it("取消 → 不调 updateKnowledge（编辑不落盘）、onCancel 触发", () => {
    const onCancel = vi.fn();
    renderEditor({ onCancel });

    fireEvent.change(screen.getByLabelText("正文编辑"), {
      target: { value: "改了但不保存" },
    });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(knowledgeApi.updateKnowledge).not.toHaveBeenCalled();
  });
});

describe("EntryEditor · decisions 只读（D-006@v1 防线）", () => {
  it("decisions zone → 只读标注 + textarea readOnly + 无保存入口", () => {
    renderEditor({ zone: "decisions", filename: "decisions/daemon.md" });

    expect(screen.getByTestId("decisions-readonly-tag")).toHaveTextContent(
      "由归档流程维护 · 只读",
    );
    expect(screen.getByLabelText("正文编辑")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "保存修改" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消" })).not.toBeInTheDocument();
  });
});
