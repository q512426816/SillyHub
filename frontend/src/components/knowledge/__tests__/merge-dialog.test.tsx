/**
 * MergeDialog 单测（task-06 / 2026-09-17-knowledge-precipitation / FR-05 / D-007@v1）。
 *
 * 依据：
 *   - frontend/src/components/knowledge/merge-dialog.tsx（对照原型 mergeModal 三段布局）
 *   - 变更 design Wave 3（两段式 merge 语义 / dupRe 幂等守卫 / R-01 409 契约）
 *     + task-06 卡片（白名单三选一无新建 / 预览零拼接 / 409 表单保留）
 *
 * 覆盖：
 *   1. 必填缺省（目标文件 / 小节标题 / 关键词任一为空）→「确认合并」禁用
 *   2. 预览渲染：表单填齐 debounce 调 preview-merge，载荷含
 *      {target_file, section_title, keywords[]}；预览区逐字渲染后端
 *      section_text / index_line（零拼接，textContent 全等断言）
 *   3. 幂等标志：section_skipped / index_line_skipped → 「将跳过」提示如实展示
 *   4. 确认调用 merge（同载荷）→ 成功 toast + onMerged + onClose
 *   5. 409 冲突（R-01 契约）→ toast 固定文案「文件在别处被修改，请刷新后重试」，
 *      弹层不关、表单内容保留可重试；其它错误走 inline 红条
 *   6. 预览失败（非 409）→ inline 错误 + 确认按钮禁用（所见即所合并）
 *
 * mock @/lib/knowledge（hoisted vi.fn）+ @/lib/errors useNotify（antd App 上下文
 * 依赖，precipitate-dialog.test 同款替换纯函数实现）。
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MergeDialog } from "@/components/knowledge/merge-dialog";
import { ApiError } from "@/lib/api";

const knowledgeApi = vi.hoisted(() => ({
  previewMergeKnowledge: vi.fn(),
  mergeKnowledge: vi.fn(),
}));
vi.mock("@/lib/knowledge", () => ({
  previewMergeKnowledge: knowledgeApi.previewMergeKnowledge,
  mergeKnowledge: knowledgeApi.mergeKnowledge,
}));

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
// useNotify 依赖 antd App 上下文，这里直接换纯函数实现（precipitate-dialog.test 先例）。
vi.mock("@/lib/errors", async () => {
  const actual = await vi.importActual<typeof import("@/lib/errors")>("@/lib/errors");
  return { ...actual, useNotify: () => notify };
});

/** 后端 dry-run 样例（格式对齐 knowledge-classify.js 的 classify 输出）。 */
const SECTION_TEXT = "## 移动端 grid 溢出\n\n根 grid 隐式行高度不受 min-h-0 约束。";
const INDEX_LINE = "- 乱码|GBK|控制台 → [移动端 grid 溢出](known-issues.md#移动端-grid-溢出)";

function mockPreview(overrides: Record<string, unknown> = {}) {
  knowledgeApi.previewMergeKnowledge.mockResolvedValue({
    section_text: SECTION_TEXT,
    index_line: INDEX_LINE,
    section_skipped: false,
    index_line_skipped: false,
    ...overrides,
  });
}

function renderDialog(
  overrides: Partial<{
    onMerged: () => void;
    onClose: () => void;
    defaultSectionTitle: string;
    defaultTargetFile: string;
  }> = {},
) {
  return render(
    <MergeDialog
      workspaceId="ws-1"
      filename="proposed/pending-fix.md"
      defaultSectionTitle={overrides.defaultSectionTitle ?? "移动端 grid 溢出"}
      defaultTargetFile={overrides.defaultTargetFile ?? null}
      onMerged={overrides.onMerged ?? (() => {})}
      onClose={overrides.onClose ?? (() => {})}
    />,
  );
}

/** 表单填齐：选目标文件 + 关键词逐个回车提交（小节标题已由 defaultSectionTitle 预填）。 */
function fillForm() {
  fireEvent.change(screen.getByLabelText("目标文件"), {
    target: { value: "known-issues.md" },
  });
  const kwInput = screen.getByLabelText("路由关键词");
  fireEvent.change(kwInput, { target: { value: "乱码" } });
  fireEvent.keyDown(kwInput, { key: "Enter" });
  fireEvent.change(kwInput, { target: { value: "GBK" } });
  fireEvent.keyDown(kwInput, { key: "Enter" });
}

/** 等到 debounce 预览落定（dry-run 返回并渲染）。 */
async function waitForPreview() {
  // toHaveTextContent 会折叠空白（换行变空格），多行 section_text 用全等断言。
  await waitFor(() =>
    expect(screen.getByTestId("section-preview").textContent).toBe(SECTION_TEXT),
  );
}

beforeEach(() => {
  knowledgeApi.previewMergeKnowledge.mockReset();
  knowledgeApi.mergeKnowledge.mockReset();
  mockPreview();
  notify.success.mockClear();
  notify.warning.mockClear();
  notify.error.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("MergeDialog · 表单与预览（D-007@v1）", () => {
  it("目标文件仅三类白名单可选，无「新建文件」入口", () => {
    renderDialog();
    const target = screen.getByLabelText("目标文件") as HTMLSelectElement;
    const options = Array.from(target.options).map((o) => o.value);
    expect(options).toEqual([
      "",
      "known-issues.md",
      "patterns.md",
      "conventions.md",
    ]);
    expect(screen.queryByText(/新建文件/)).not.toBeInTheDocument();
  });

  it("必填缺省（目标/标题/关键词）→ 确认禁用；填齐且预览就绪后可用", async () => {
    renderDialog();
    const confirm = screen.getByTestId("confirm-merge");
    expect(confirm).toBeDisabled();

    // 只选目标文件（标题预填但关键词为空）仍禁用，且不发预览请求。
    fireEvent.change(screen.getByLabelText("目标文件"), {
      target: { value: "patterns.md" },
    });
    expect(confirm).toBeDisabled();
    expect(knowledgeApi.previewMergeKnowledge).not.toHaveBeenCalled();

    // 清空小节标题 + 补齐关键词 → 仍禁用（标题必填）。
    const kwInput = screen.getByLabelText("路由关键词");
    fireEvent.change(kwInput, { target: { value: "乱码" } });
    fireEvent.keyDown(kwInput, { key: "Enter" });
    fireEvent.change(screen.getByLabelText(/^小节标题/), { target: { value: "" } });
    expect(confirm).toBeDisabled();
    expect(knowledgeApi.previewMergeKnowledge).not.toHaveBeenCalled();

    // 全部填齐 → debounce 后预览落定、确认可用。
    fireEvent.change(screen.getByLabelText(/^小节标题/), {
      target: { value: "移动端 grid 溢出" },
    });
    await waitForPreview();
    await waitFor(() => expect(confirm).toBeEnabled());
  });

  it("预览零拼接：逐字渲染后端 section_text / index_line，载荷字段形态对齐 KnowledgeMergeIn", async () => {
    renderDialog();
    fillForm();
    await waitForPreview();

    // 载荷：target_file / section_title / keywords[]（join '|' 由后端 build_route_line 处理）。
    await waitFor(() =>
      expect(knowledgeApi.previewMergeKnowledge).toHaveBeenCalledWith("ws-1", "proposed/pending-fix.md", {
        target_file: "known-issues.md",
        section_title: "移动端 grid 溢出",
        keywords: expect.arrayContaining(["乱码", "GBK"]),
      }),
    );

    // 预览区逐字渲染（textContent 全等 = 非前端拼接）。
    expect(screen.getByTestId("section-preview").textContent).toBe(SECTION_TEXT);
    expect(screen.getByTestId("index-preview").textContent).toBe(INDEX_LINE);
    // 关键词 chip 展示。
    expect(screen.getByText("乱码")).toBeInTheDocument();
    expect(screen.getByText("GBK")).toBeInTheDocument();
  });

  it("幂等标志：section_skipped / index_line_skipped → 如实展示「已存在将跳过」提示", async () => {
    mockPreview({ section_text: "", section_skipped: true, index_line_skipped: true });
    renderDialog();
    fillForm();

    await waitFor(() =>
      expect(screen.getByTestId("section-skipped-note")).toHaveTextContent(
        /已存在同名.*将跳过追加/,
      ),
    );
    // section_skipped 时后端返回空 section_text，不渲染空预览块。
    expect(screen.queryByTestId("section-preview")).not.toBeInTheDocument();
    expect(screen.getByTestId("index-skipped-note")).toHaveTextContent(/已含相同路由行.*跳过补行/);
    // INDEX 行仍展示（后端照常返回，前端不加戏）。
    expect(screen.getByTestId("index-preview").textContent).toBe(INDEX_LINE);
  });

  it("预览失败（非 409）→ inline 错误 + 确认禁用（不允许未预览确认）", async () => {
    knowledgeApi.previewMergeKnowledge.mockRejectedValue(new Error("候选已被合并"));
    renderDialog();
    fillForm();

    await waitFor(() => expect(screen.getByText("候选已被合并")).toBeInTheDocument());
    expect(screen.getByTestId("confirm-merge")).toBeDisabled();
    expect(knowledgeApi.mergeKnowledge).not.toHaveBeenCalled();
  });
});

describe("MergeDialog · 确认合并与 409 冲突（R-01 契约）", () => {
  it("确认调 merge（同载荷，单次调用不拆两段）→ 成功 toast + onMerged + onClose", async () => {
    knowledgeApi.mergeKnowledge.mockResolvedValue({
      merged: true,
      target_file: "known-issues.md",
      section_title: "移动端 grid 溢出",
      index_line: INDEX_LINE,
      section_appended: true,
      index_updated: true,
    });
    const onMerged = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onMerged, onClose });
    fillForm();
    await waitForPreview();

    fireEvent.click(screen.getByTestId("confirm-merge"));

    await waitFor(() => expect(knowledgeApi.mergeKnowledge).toHaveBeenCalledTimes(1));
    expect(knowledgeApi.mergeKnowledge).toHaveBeenCalledWith("ws-1", "proposed/pending-fix.md", {
      target_file: "known-issues.md",
      section_title: "移动端 grid 溢出",
      keywords: expect.arrayContaining(["乱码", "GBK"]),
    });
    await waitFor(() => expect(onMerged).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(notify.success).toHaveBeenCalledWith(
      "已合并进 known-issues.md 并更新 INDEX 路由",
    );
  });

  it("409 冲突 → toast 固定文案「文件在别处被修改，请刷新后重试」且表单保留可重试", async () => {
    knowledgeApi.mergeKnowledge.mockRejectedValue(
      new ApiError(409, {
        code: "HTTP_409_KNOWLEDGE_WRITE_CONFLICT",
        message: "文件在别处被修改，请刷新后重试",
        request_id: null,
        details: { conflict: true, server_versions: { "knowledge/known-issues.md": 3 } },
      }),
    );
    const onMerged = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onMerged, onClose });
    fillForm();
    await waitForPreview();

    fireEvent.click(screen.getByTestId("confirm-merge"));

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith("文件在别处被修改，请刷新后重试"));
    // 弹层不关、不触发刷新；表单内容保留（标题 / 关键词 / 目标文件）。
    expect(onClose).not.toHaveBeenCalled();
    expect(onMerged).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^小节标题/)).toHaveValue("移动端 grid 溢出");
    expect(screen.getByText("乱码")).toBeInTheDocument();
    expect(screen.getByText("GBK")).toBeInTheDocument();
    expect(
      (screen.getByLabelText("目标文件") as HTMLSelectElement).value,
    ).toBe("known-issues.md");
    // 失败后按钮回到可用（非提交中卡死），可重试。
    await waitFor(() => expect(screen.getByTestId("confirm-merge")).toBeEnabled());
  });

  it("其它错误（非 409）→ inline 红条展示，弹层不关", async () => {
    knowledgeApi.mergeKnowledge.mockRejectedValue(new Error("INDEX.md 读取失败"));
    const onMerged = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onMerged, onClose });
    fillForm();
    await waitForPreview();

    fireEvent.click(screen.getByTestId("confirm-merge"));

    await waitFor(() => expect(screen.getByText("INDEX.md 读取失败")).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(onMerged).not.toHaveBeenCalled();
  });
});

// ql-20260918-007：默认值（目标文件按 category 映射传入 / 关键词标题分词预填）
// + 目标不存在将新建提示。
describe("MergeDialog 默认值与目标新建（ql-20260918-007）", () => {
  it("defaultTargetFile 预选目标、defaultSectionTitle 分词预填关键词（可改）", async () => {
    mockPreview({ target_will_create: false });
    renderDialog({
      defaultSectionTitle: "Maven 双仓库 settings.xml 指冷仓库",
      defaultTargetFile: "known-issues.md",
    });
    // 目标文件默认已选
    const select = screen.getByLabelText(/目标文件/) as HTMLSelectElement;
    expect(select.value).toBe("known-issues.md");
    // 关键词按标题分词预填（表单完整 → 预览自动触发）
    await waitFor(() => expect(knowledgeApi.previewMergeKnowledge).toHaveBeenCalled());
    const payload = knowledgeApi.previewMergeKnowledge.mock.calls[0]![2];
    expect(payload.keywords).toEqual(
      expect.arrayContaining(["Maven", "双仓库", "settings"])
    );
    expect(payload.target_file).toBe("known-issues.md");
  });

  it("preview.target_will_create → 展示「目标文件尚不存在，合并将自动创建」提示", async () => {
    mockPreview({ target_will_create: true });
    renderDialog();
    fillForm();
    await waitFor(() =>
      expect(screen.getByTestId("target-will-create-note")).toBeInTheDocument(),
    );
  });
});
