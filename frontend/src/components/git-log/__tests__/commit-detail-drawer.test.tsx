/**
 * task-06：提交详情抽屉测试。
 *
 * 覆盖（acceptance「diff 展开按需请求」）：
 * 1. Drawer 关闭（open=false）时 hook 以 enabled=false 调用
 *    （真实 useGitLogCommitDetail 该态零请求）；
 * 2. 打开后详情渲染：哈希/作者/message 全文/refs 标签/文件树；未点叶子时
 *    useGitLogDiff 零请求；
 * 3. 点击文件叶子才发起 diff 请求（enabled=true）；
 * 4. 详情 pending/error 形态（加载中 / 中文错误条）。
 *
 * 依据：tasks/task-06.md acceptance、design.md §5.4。
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommitDetailDrawer } from "@/components/git-log/commit-detail-drawer";
import { ApiError } from "@/lib/api";
import type { GitLogCommitDetailResponse } from "@/lib/git-log";

// ── mock @/lib/git-log：接管 useGitLogCommitDetail / useGitLogDiff ──────

const gitLogMock = vi.hoisted(() => ({
  useGitLogCommitDetail: vi.fn(),
  useGitLogDiff: vi.fn(),
}));
vi.mock("@/lib/git-log", async () => {
  const actual = await vi.importActual<typeof import("@/lib/git-log")>(
    "@/lib/git-log",
  );
  return {
    ...actual,
    useGitLogCommitDetail: gitLogMock.useGitLogCommitDetail,
    useGitLogDiff: gitLogMock.useGitLogDiff,
  };
});

const DETAIL: GitLogCommitDetailResponse = {
  hash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  short: "a1b2c3d",
  parents: [],
  message: "feat: 测试提交\n\n正文第二行",
  author_name: "qinyi",
  author_email: "qinyi@example.com",
  author_date: "2026-08-25T12:00:00Z",
  committer_date: "2026-08-25T12:00:00Z",
  refs: [
    { name: "HEAD", kind: "head" },
    { name: "main", kind: "branch" },
    { name: "v1.0", kind: "tag" },
  ],
  files: [
    { path: "src/a.ts", add: 3, del: 1, binary: false },
    { path: "logo.png", add: 0, del: 0, binary: true },
  ],
};

function detailResult(overrides: Record<string, unknown> = {}) {
  return { data: DETAIL, isPending: false, isError: false, error: null, ...overrides };
}

function renderDrawer(open: boolean, sha: string | null = DETAIL.hash) {
  return render(
    <CommitDetailDrawer
      workspaceId="ws-1"
      sha={sha}
      open={open}
      onClose={() => {}}
    />,
  );
}

beforeEach(() => {
  gitLogMock.useGitLogCommitDetail.mockReset();
  gitLogMock.useGitLogCommitDetail.mockReturnValue(detailResult());
  gitLogMock.useGitLogDiff.mockReset();
  gitLogMock.useGitLogDiff.mockReturnValue({
    data: { diff: "@@ -1 +1 @@\n-a\n+b", truncated: false, binary: false },
    isPending: false,
    isError: false,
    error: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("CommitDetailDrawer", () => {
  it("open=false 时 hook 以 enabled=false 调用（真实 hook 该态零请求）", () => {
    renderDrawer(false);

    // 组件恒调用 hook（React 规则），按需性由 enabled 入参表达：
    // open=false → enabled=false → 真实 useGitLogCommitDetail 不发请求
    expect(gitLogMock.useGitLogCommitDetail).toHaveBeenCalledWith(
      "ws-1",
      DETAIL.hash,
      false,
    );
  });

  it("打开即拉详情：哈希/作者/message/refs/文件树渲染，diff 零请求", async () => {
    renderDrawer(true);

    await waitFor(() => {
      expect(gitLogMock.useGitLogCommitDetail).toHaveBeenCalledWith(
        "ws-1",
        DETAIL.hash,
        true,
      );
    });

    // 详情字段（哈希 monospace 展示全文；多行 message 走正则部分匹配）
    expect(screen.getByTestId("git-log-detail-hash")).toHaveTextContent(
      DETAIL.hash,
    );
    const meta = screen.getByTestId("git-log-detail-meta");
    expect(meta).toHaveTextContent("qinyi");
    expect(meta).toHaveTextContent("qinyi@example.com");
    expect(screen.getByText(/feat: 测试提交/)).toBeInTheDocument();

    // refs 标签：HEAD / main / v1.0（tag）
    expect(screen.getByText("HEAD")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("v1.0")).toBeInTheDocument();

    // 文件树叶子可见；未点击前 useGitLogDiff 零请求（按需）
    expect(screen.getByTestId("git-log-file-src/a.ts")).toBeInTheDocument();
    expect(gitLogMock.useGitLogDiff).not.toHaveBeenCalled();
  });

  it("点击叶子才发起 diff 请求，diff 渲染于抽屉内", async () => {
    renderDrawer(true);

    fireEvent.click(screen.getByTestId("git-log-file-src/a.ts"));

    await waitFor(() => {
      expect(gitLogMock.useGitLogDiff).toHaveBeenCalledWith(
        "ws-1",
        DETAIL.hash,
        "src/a.ts",
        true,
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("git-log-diff")).toBeInTheDocument();
    });
  });

  it("详情加载中显示「加载中…」", () => {
    gitLogMock.useGitLogCommitDetail.mockReturnValue(
      detailResult({ data: null, isPending: true }),
    );
    renderDrawer(true);

    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });

  it("详情失败渲染中文错误条", () => {
    gitLogMock.useGitLogCommitDetail.mockReturnValue(
      detailResult({
        data: null,
        isError: true,
        error: new ApiError(502, {
          code: "git_log_error",
          message: "守护进程离线",
          request_id: null,
          details: null,
        }),
      }),
    );
    renderDrawer(true);

    expect(screen.getByText("守护进程离线")).toBeInTheDocument();
  });
});
