/**
 * task-05（2026-10-25-explorer-git-status）：工作区单文件 diff 弹窗测试
 * （三态渲染 / truncated / binary / 错误分型降级 / enabled 门）。
 *
 * 覆盖（tasks/task-05.md acceptance + design §Phase 3 / D-004 / D-010）：
 * 1. 三态渲染：modified 红绿行（data-diff-kind add/del 并存）、untracked
 *    全 + 行（no-index 全新增形态）、deleted 全 − 行；
 * 2. truncated=true 截断提示条；binary=true 只提示不渲染 diff；
 * 3. 错误分型：422 daemon 版本过旧（不可重试升级引导）/ 404 未绑定与文件
 *    不存在两文案 / 502 离线（带重试）/ 504 超时；
 * 4. enabled 门：open=false 或 path=null 不取数（apiFetch 零调用）；
 * 5. 头部：状态徽标（响应值优先）+ 文件路径 + 基线 head_short；空 diff
 *    竞态提示。
 *
 * mock 策略对齐 worktree-changes-card.test.tsx：仅 mock @/lib/api 的
 * apiFetch，真实 react-query（enabled 门与 refetch 断言才有意义）。
 * Modal 壳为 antd——用真实 Modal 渲染（jsdom 下 portal 正常挂 body）。
 *
 * 依据：tasks/task-05.md、design.md §Phase 3、prototype-explorer-git-status.html ②。
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WorktreeDiffModal } from "@/components/git-log/worktree-diff-modal";
import type { GitWorktreeDiffResponse } from "@/lib/git-log";

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: apiFetchMock };
});

const MODIFIED_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,3 @@",
  " context line",
  "-old line",
  "+new line 中文",
].join("\n");

const UNTRACKED_DIFF = [
  "diff --git a/notes/new.md b/notes/new.md",
  "--- /dev/null",
  "+++ b/notes/new.md",
  "@@ -0,0 +1,2 @@",
  "+第一行",
  "+第二行",
].join("\n");

const DELETED_DIFF = [
  "diff --git a/gone.ts b/gone.ts",
  "--- a/gone.ts",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-第一行",
  "-第二行",
].join("\n");

function makeDiff(
  overrides: Partial<GitWorktreeDiffResponse> = {},
): GitWorktreeDiffResponse {
  return {
    status: "modified",
    head_short: "a9f5fae1",
    diff: MODIFIED_DIFF,
    truncated: false,
    binary: false,
    ...overrides,
  };
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderModal(props: Partial<Parameters<typeof WorktreeDiffModal>[0]> = {}) {
  const client = makeClient();
  const view = render(
    <QueryClientProvider client={client}>
      <WorktreeDiffModal
        workspaceId="ws-1"
        path="src/a.ts"
        status="modified"
        open
        onClose={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

beforeEach(() => {
  apiFetchMock.mockReset();
});
afterEach(() => {
  cleanup();
});

/** 等待 diff 体渲染完成（数据 resolve 后 DiffBody 挂载；标题元素先于数据就绪，不可作锚）。 */
async function awaitDiffBody(): Promise<HTMLElement> {
  await waitFor(() => {
    if (document.querySelector('[data-testid="git-log-diff"]') === null) {
      throw new Error("diff body not rendered yet");
    }
  });
  const el = document.querySelector('[data-testid="git-log-diff"]');
  if (el === null) throw new Error("diff body disappeared");
  return el as HTMLElement;
}

describe("WorktreeDiffModal — 三态渲染（task-05）", () => {
  it("modified：红绿行并存（del + add），头部徽标「修改」+ 基线 head_short", async () => {
    apiFetchMock.mockImplementation(() => Promise.resolve(makeDiff()));
    renderModal();
    const body = await awaitDiffBody();
    expect(body.querySelectorAll('[data-diff-kind="add"]').length).toBe(1);
    expect(body.querySelectorAll('[data-diff-kind="del"]').length).toBe(1);
    expect(screen.getByTestId("worktree-diff-status-badge")).toHaveTextContent("修改");
    expect(screen.getByText("a9f5fae1")).toBeInTheDocument();
    expect(
      screen.getByText(/工作区当前内容 vs HEAD（不区分暂存）/),
    ).toBeInTheDocument();
  });

  it("untracked（status=added）：全 + 行（no-index 全新增形态）", async () => {
    apiFetchMock.mockImplementation(() =>
      Promise.resolve(makeDiff({ status: "added", diff: UNTRACKED_DIFF })),
    );
    renderModal({ status: "untracked", path: "notes/new.md" });
    const body = await awaitDiffBody();
    expect(body.querySelectorAll('[data-diff-kind="add"]').length).toBe(2);
    expect(body.querySelectorAll('[data-diff-kind="del"]').length).toBe(0);
    expect(screen.getByTestId("worktree-diff-status-badge")).toHaveTextContent("新增");
  });

  it("deleted：全 − 行（响应状态优先于 props 展示态）", async () => {
    apiFetchMock.mockImplementation(() =>
      Promise.resolve(makeDiff({ status: "deleted", diff: DELETED_DIFF })),
    );
    renderModal({ status: "modified", path: "gone.ts" });
    const body = await awaitDiffBody();
    expect(body.querySelectorAll('[data-diff-kind="del"]').length).toBe(2);
    expect(body.querySelectorAll('[data-diff-kind="add"]').length).toBe(0);
    // 响应 status=deleted 优先：徽标「删除」而非 props 的「修改」。
    expect(screen.getByTestId("worktree-diff-status-badge")).toHaveTextContent("删除");
  });
});

describe("WorktreeDiffModal — truncated / binary / 空态（task-05）", () => {
  it("truncated=true → 顶部截断提示条", async () => {
    apiFetchMock.mockImplementation(() =>
      Promise.resolve(makeDiff({ truncated: true })),
    );
    renderModal();
    await waitFor(() => {
      expect(screen.getByTestId("worktree-diff-truncated")).toHaveTextContent(
        "文件差异超过 64KB 上限",
      );
    });
  });

  it("binary=true → 只提示不渲染 diff 行", async () => {
    apiFetchMock.mockImplementation(() =>
      Promise.resolve(makeDiff({ binary: true, diff: "" })),
    );
    renderModal({ path: "logo.png" });
    await waitFor(() => {
      expect(screen.getByTestId("worktree-diff-binary")).toHaveTextContent(
        "二进制文件，不支持文本 diff",
      );
    });
    expect(document.querySelector('[data-testid="git-log-diff"]')).toBeNull();
  });

  it("空 diff（竞态已提交）→ 轻提示", async () => {
    apiFetchMock.mockImplementation(() =>
      Promise.resolve(makeDiff({ diff: "" })),
    );
    renderModal();
    await waitFor(() => {
      expect(screen.getByTestId("worktree-diff-empty")).toHaveTextContent(
        "已无差异",
      );
    });
  });
});

describe("WorktreeDiffModal — 错误分型降级（task-05，对齐 scope-file-diff-modal）", () => {
  async function renderWithApiError(status: number, code: string) {
    const { ApiError } = (await vi.importActual("@/lib/api")) as typeof import("@/lib/api");
    apiFetchMock.mockImplementation(() =>
      Promise.reject(
        new ApiError(status, { code, message: "boom", request_id: null, details: null }),
      ),
    );
    renderModal();
    await waitFor(() => {
      expect(screen.getByTestId("worktree-diff-error")).toBeInTheDocument();
    });
    return screen.getByTestId("worktree-diff-error");
  }

  it("422 daemon 版本过旧 → 升级引导，无重试按钮", async () => {
    const box = await renderWithApiError(422, "HTTP_422_GIT_LOG_DAEMON_TOO_OLD");
    expect(box).toHaveTextContent("本机 daemon 版本过旧");
    expect(box).toHaveTextContent("升级 daemon");
    expect(screen.queryByText("重试")).not.toBeInTheDocument();
  });

  it("404 未绑定 → 成员页引导；404 文件不存在 → 刷新引导", async () => {
    const notBound = await renderWithApiError(404, "HTTP_404_GIT_LOG_NOT_BOUND");
    expect(notBound).toHaveTextContent("未绑定本机工作区");
    cleanup();
    apiFetchMock.mockClear();
    const gone = await renderWithApiError(404, "HTTP_404_GIT_LOG_COMMIT_NOT_FOUND");
    expect(gone).toHaveTextContent("文件可能已被提交或删除");
  });

  it("502 离线 → 带重试按钮", async () => {
    const box = await renderWithApiError(502, "HTTP_502_GIT_LOG_DAEMON_OFFLINE");
    expect(box).toHaveTextContent("守护进程离线");
    expect(screen.getByText("重试")).toBeInTheDocument();
  });

  it("504 超时 → 超时文案 + 重试", async () => {
    const box = await renderWithApiError(504, "HTTP_504_GIT_LOG_RPC_TIMEOUT");
    expect(box).toHaveTextContent("查询超时");
    expect(screen.getByText("重试")).toBeInTheDocument();
  });
});

describe("WorktreeDiffModal — enabled 门（task-05）", () => {
  it("open=false 不取数（apiFetch 零调用）", () => {
    renderModal({ open: false });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("path=null 不取数；关闭后重新打开按新 path 取数", async () => {
    const onClose = vi.fn();
    const { rerender } = renderModal({ path: null, onClose });
    expect(apiFetchMock).not.toHaveBeenCalled();

    apiFetchMock.mockImplementation(() => Promise.resolve(makeDiff()));
    const client = makeClient();
    rerender(
      <QueryClientProvider client={client}>
        <WorktreeDiffModal
          workspaceId="ws-1"
          path="src/b.ts"
          status="modified"
          open
          onClose={onClose}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledTimes(1);
    });
    expect(String(apiFetchMock.mock.calls[0]?.[0] ?? "")).toContain("/git-log/worktree-diff");
  });

  it("onCancel（关闭）→ onClose 回调（受控组件）", async () => {
    apiFetchMock.mockImplementation(() => Promise.resolve(makeDiff()));
    const onClose = vi.fn();
    renderModal({ onClose });
    await waitFor(() => {
      expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    });
    fireEvent.click(document.querySelector(".ant-modal-close") as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });
});
