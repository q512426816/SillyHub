/**
 * patch-previewer 测试（2026-10-13-change-files-view-polish）：change.patch
 * 全屏按文件折叠树分发 + 回落整片 DiffView。
 */

import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// jsdom Blob 缺 text()，补 polyfill（同 markdown-previewer.test.tsx 既有范式）
if (typeof Blob !== "undefined" && !Blob.prototype.text) {
  Blob.prototype.text = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(this);
    });
  };
}

import { PatchPreviewer } from "../previewers/patch-previewer";

const multiFilePatch = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 123..456 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,2 @@",
  "-old",
  "+new",
  "diff --git a/src/b.ts b/src/b.ts",
  "index 789..abc 100644",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1 +1 @@",
  "-x",
  "+y",
].join("\n");

beforeEach(() => {
  Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:mock"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PatchPreviewer change.patch 分发", () => {
  it("change.patch 多文件 → PatchTreeView（与内联同源），默认收起", async () => {
    const { container } = render(
      <PatchPreviewer
        blob={new Blob([multiFilePatch], { type: "text/x-diff" })}
        url="blob:mock"
        meta={{ name: "change.patch", mime: "text/x-diff", size: 200 }}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="patch-tree-view"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-testid="diff-view"]')).toBeNull();
    expect(container.textContent).toContain("2 个文件");
  });

  it("其他 patch 文件（scope-audit.patch 等）→ 整片 DiffView 不变", async () => {
    const { container } = render(
      <PatchPreviewer
        blob={new Blob([multiFilePatch], { type: "text/x-diff" })}
        url="blob:mock"
        meta={{ name: "scope-audit.patch", mime: "text/x-diff", size: 200 }}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="diff-view"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-testid="patch-tree-view"]')).toBeNull();
  });

  it("change.patch 无 diff --git 头 → 回落整片 DiffView（其内部回落纯文本）", async () => {
    const { container } = render(
      <PatchPreviewer
        blob={new Blob(["不是 diff 格式的文本"], { type: "text/x-diff" })}
        url="blob:mock"
        meta={{ name: "change.patch", mime: "text/x-diff", size: 20 }}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="diff-view-raw"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-testid="patch-tree-view"]')).toBeNull();
  });
});
