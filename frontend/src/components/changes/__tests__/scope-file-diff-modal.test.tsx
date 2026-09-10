/**
 * 单文件变化比对弹窗测试（ql-20260910-017-2006）。
 *
 * 覆盖：
 *   1. diff 渲染：parseUnifiedDiff 行投影（+绿/-红/hunk 行 data-diff-kind 锚）
 *      + 头部锚点条（anchor_label / 变更名）+ 文件路径标题
 *   2. note 态：diff null + note（untracked 新文件）→ 文案展示不出 diff 行
 *   3. 422 升级引导族：SILLYSPEC_TOO_OLD → 「本机版本暂不支持」且无重试按钮
 *   4. 502 离线族：失败文案 + 重试按钮
 *   5. 关闭态不拉取（enabled 门控）
 *
 * mock 范式照 scope-audit-command-card.test：importActual 部分 mock +
 * QueryClientProvider（retry: false）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScopeFileDiffModal } from "@/components/changes/scope-file-diff-modal";
import { ApiError } from "@/lib/api";
import type { ScopeFileDiffResponse } from "@/lib/changes";

const mocks = vi.hoisted(() => ({
  getScopeFileDiff: vi.fn(),
}));

vi.mock("@/lib/changes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/changes")>(
    "@/lib/changes",
  );
  return { ...actual, getScopeFileDiff: mocks.getScopeFileDiff };
});

const DIFF_TEXT = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,2 @@",
  " context line",
  "-old line",
  "+new line",
].join("\n");

function makeResult(
  overrides: Partial<ScopeFileDiffResponse> = {},
): ScopeFileDiffResponse {
  return {
    change: "2026-09-10-mcp-central-registry",
    file: "src/a.ts",
    ok: true,
    mode: "full-flow",
    base_ref: "3f22d6b",
    anchor_label: "3f22d6b",
    diff: DIFF_TEXT,
    note: null,
    truncated: false,
    ...overrides,
  };
}

function renderModal(props: {
  open: boolean;
  change?: string | null;
  filePath?: string | null;
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ScopeFileDiffModal
        open={props.open}
        onClose={() => undefined}
        workspaceId="ws-1"
        change={props.change ?? "2026-09-10-mcp-central-registry"}
        filePath={props.filePath ?? "src/a.ts"}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ql-20260910-017-2006 ScopeFileDiffModal：diff 渲染", () => {
  it("diff 文本 → +绿/-红/hunk 行锚点齐全；头部锚点条含 anchor_label 与变更名", async () => {
    mocks.getScopeFileDiff.mockResolvedValue(makeResult());
    renderModal({ open: true });

    await waitFor(() => {
      expect(screen.getByTestId("scope-file-diff-body")).toBeInTheDocument();
    });
    // parseUnifiedDiff 行投影：hunk / del / add 三类行锚点（ctx 行无语义色）。
    // data-diff-kind 挂在行 div 上（内层 span 才是文本节点），按行选择器断言。
    expect(screen.getByText("@@ -1,2 +1,2 @@")).toBeInTheDocument();
    const delRows = document.querySelectorAll('[data-diff-kind="del"]');
    const addRows = document.querySelectorAll('[data-diff-kind="add"]');
    expect(delRows.length).toBe(1);
    expect(delRows[0]!.textContent).toContain("old line");
    expect(addRows.length).toBe(1);
    expect(addRows[0]!.textContent).toContain("new line");
    // 头部锚点条 + 标题路径
    expect(screen.getByText("3f22d6b")).toBeInTheDocument();
    expect(screen.getByTestId("scope-file-diff-path")).toHaveTextContent(
      "src/a.ts",
    );
    // 取数参数
    expect(mocks.getScopeFileDiff).toHaveBeenCalledWith(
      "ws-1",
      "2026-09-10-mcp-central-registry",
      "src/a.ts",
    );
  });

  it("note 态（untracked 新文件，diff=null）→ note 文案展示、不出 diff 行", async () => {
    mocks.getScopeFileDiff.mockResolvedValue(
      makeResult({
        mode: "quick",
        diff: null,
        base_ref: "HEAD",
        anchor_label: "HEAD 未提交窗口",
        note: "未跟踪新文件——不在 git diff 内，文件全部行为新增；直接查看文件本体",
      }),
    );
    renderModal({ open: true, change: "quick-a1b2c3d4" });

    await waitFor(() => {
      expect(
        screen.getByText(/未跟踪新文件——不在 git diff 内/),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId("scope-file-diff-body")).toBeNull();
    expect(screen.getByText("快速修复")).toBeInTheDocument();
  });
});

describe("ql-20260910-017-2006 ScopeFileDiffModal：错误态分型", () => {
  it("422 SILLYSPEC_TOO_OLD → 升级引导文案且无重试按钮", async () => {
    mocks.getScopeFileDiff.mockRejectedValue(
      new ApiError(422, {
        code: "HTTP_422_SCOPE_FILE_DIFF_SILLYSPEC_TOO_OLD",
        message: "本机 sillyspec 版本不支持 scope-audit 命令，请升级 sillyspec 后重试。",
        request_id: null,
        details: null,
      }),
    );
    renderModal({ open: true });

    expect(
      await screen.findByText("本机版本暂不支持文件比对"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/升级 sillyspec 后即可在变更中心直接查看文件变化/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
  });

  it("502 离线族 → 失败文案 + 重试按钮（点击重发）", async () => {
    mocks.getScopeFileDiff.mockRejectedValue(
      new ApiError(502, {
        code: "HTTP_502_SCOPE_FILE_DIFF_DAEMON_OFFLINE",
        message: "本机守护进程当前离线。",
        request_id: null,
        details: null,
      }),
    );
    renderModal({ open: true });

    expect(await screen.findByText("读取文件变化失败")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "重试" });
    fireEvent.click(retry);
    await waitFor(() =>
      expect(mocks.getScopeFileDiff.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it("关闭态（open=false）不拉取", () => {
    renderModal({ open: false });
    expect(mocks.getScopeFileDiff).not.toHaveBeenCalled();
  });
});
