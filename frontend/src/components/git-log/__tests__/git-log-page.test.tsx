/**
 * task-06：Git 日志页冒烟测试（含 WorkspaceTabs 注册断言）。
 *
 * 覆盖（acceptance「TABS 增至 15 项」+「空态卡/三降级卡分发」）：
 * 1. git_mode=no_git → 空态卡（探测说明文案）+ 工具栏（分支下拉/作者输入/刷新）；
 * 2. 正常数据 → 列表渲染 + 副标题「已加载 N 条」+ 加载更多（skip 递增翻页）；
 * 3. 502 查询错误 → 三降级卡（daemon 离线中文文案）；
 * 4. WorkspaceTabs 含第 15 项「Git 日志」（纯三字段，path=/git-log，末位），
 *    当前路径高亮（explorer-page.test.tsx 先例形态照抄）。
 *
 * 依据：tasks/task-06.md acceptance、design.md §5.4 / §7.4。
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import GitLogPage from "@/app/(dashboard)/workspaces/[id]/git-log/page";
import { WorkspaceTabs } from "@/components/workspace-tabs";
import { ApiError } from "@/lib/api";
import type { GitLogCommitsResponse } from "@/lib/git-log";

// ── next/navigation mock（页面从 useParams 取 workspaceId）──────────────

const nav = vi.hoisted(() => ({ params: { id: "ws-1" } }));
vi.mock("next/navigation", () => ({
  useParams: () => nav.params,
  usePathname: () => `/workspaces/${nav.params.id}/git-log`,
}));

// next/link 在 jsdom 下透传 props（WorkspaceTabs 断言依赖）
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// ── mock @/lib/git-log：fetchGitLogCommits（useQueries 逐页取数）+ hooks ──

const gitLogMock = vi.hoisted(() => ({
  fetchGitLogCommits: vi.fn(),
  useGitLogCommitDetail: vi.fn(),
  useGitLogDiff: vi.fn(),
}));
vi.mock("@/lib/git-log", async () => {
  const actual = await vi.importActual<typeof import("@/lib/git-log")>(
    "@/lib/git-log",
  );
  return {
    ...actual,
    fetchGitLogCommits: gitLogMock.fetchGitLogCommits,
    useGitLogCommitDetail: gitLogMock.useGitLogCommitDetail,
    useGitLogDiff: gitLogMock.useGitLogDiff,
  };
});

// ── mock @/lib/workspaces：副标题工作区名 ─────────────────────────────

vi.mock("@/lib/workspaces", () => ({
  getWorkspace: vi.fn(async () => ({ id: "ws-1", name: "演示工作区" })),
}));

function makeCommitsResponse(
  overrides: Partial<GitLogCommitsResponse> = {},
): GitLogCommitsResponse {
  return {
    git_mode: "git",
    commits: [],
    branches: [
      { name: "main", kind: "branch" },
      { name: "origin/main", kind: "remote" },
    ],
    head: null,
    has_more: false,
    total_in_window: 0,
    ...overrides,
  };
}

function makeCommit(seq: number) {
  return {
    seq,
    hash: `hash000${seq}${"0".repeat(30)}`,
    short: `s0${seq}`,
    parents: [],
    message: `提交信息 ${seq}`,
    author_name: "qinyi",
    author_email: "qinyi@example.com",
    author_date: "2026-08-25T12:00:00Z",
    lane: 0,
    edges: [{ to_seq: seq + 1, to_lane: 0, kind: "straight" as const }],
    refs: seq === 0 ? [{ name: "HEAD", kind: "head" as const }] : [],
  };
}

function makeApiError(status: number, message: string): ApiError {
  return new ApiError(status, {
    code: "git_log_error",
    message,
    request_id: null,
    details: null,
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <GitLogPage />
    </QueryClientProvider>,
  );
}

/** jsdom 下 offsetWidth/offsetHeight 恒 0，react-virtual 视口为空（行不渲染）；
 *  happy-path 用例给 HTMLElement 补非零 offset（await 在补丁生效期内完成）。
 *  （virtual-core getRect 读 offsetWidth/offsetHeight，mock getBoundingClientRect 无效） */
async function withNonZeroViewport<T>(fn: () => Promise<T>): Promise<T> {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const heightDesc = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
  const widthDesc = Object.getOwnPropertyDescriptor(proto, "offsetWidth");
  Object.defineProperty(proto, "offsetHeight", {
    configurable: true,
    get: () => 720,
  });
  Object.defineProperty(proto, "offsetWidth", {
    configurable: true,
    get: () => 900,
  });
  try {
    return await fn();
  } finally {
    if (heightDesc) Object.defineProperty(proto, "offsetHeight", heightDesc);
    if (widthDesc) Object.defineProperty(proto, "offsetWidth", widthDesc);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  nav.params = { id: "ws-1" };
  gitLogMock.useGitLogCommitDetail.mockReturnValue({
    data: null,
    isPending: false,
    isError: false,
    error: null,
  });
  gitLogMock.useGitLogDiff.mockReturnValue({
    data: null,
    isPending: false,
    isError: false,
    error: null,
  });
});

afterEach(() => {
  cleanup();
});

// ── 页面降级与空态 ────────────────────────────────────────────────────

describe("Git 日志页（task-06）", () => {
  it("git_mode=no_git → 空态卡 + 工具栏，不渲染列表", async () => {
    gitLogMock.fetchGitLogCommits.mockResolvedValue(
      makeCommitsResponse({ git_mode: "no_git", branches: [] }),
    );
    renderPage();

    expect(
      await screen.findByTestId("git-log-no-git"),
    ).toBeInTheDocument();
    expect(screen.getByText("该工作区不是 Git 仓库")).toBeInTheDocument();
    expect(screen.getByText(/目录下未发现 \.git/)).toBeInTheDocument();

    // 工具栏仍在（空分支下拉只有「全部分支」；antd 组件按 role/placeholder 查询）
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("按作者过滤（回车生效）"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();
    expect(screen.queryByTestId("git-log-commit-list")).not.toBeInTheDocument();
  });

  it("空仓库（git_mode=git 且 commits 空）→ 空仓库卡", async () => {
    gitLogMock.fetchGitLogCommits.mockResolvedValue(makeCommitsResponse());
    renderPage();

    expect(
      await screen.findByTestId("git-log-empty-repo"),
    ).toBeInTheDocument();
    expect(screen.getByText("仓库还没有提交")).toBeInTheDocument();
  });

  it("502 → 三降级卡（daemon 离线中文文案），工具栏隐藏", async () => {
    gitLogMock.fetchGitLogCommits.mockRejectedValue(
      makeApiError(502, "守护进程离线"),
    );
    renderPage();

    expect(await screen.findByText("守护进程离线")).toBeInTheDocument();
    expect(
      screen.getByText(
        "本机守护进程离线，无法读取 Git 提交历史。请启动 daemon 后刷新。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "刷新" }),
    ).not.toBeInTheDocument();
  });

  it("422 → daemon 版本过旧卡", async () => {
    gitLogMock.fetchGitLogCommits.mockRejectedValue(
      makeApiError(422, "daemon 版本过旧"),
    );
    renderPage();

    expect(await screen.findByText("守护进程版本过旧")).toBeInTheDocument();
  });

  it("其它错误 → 通用红条（role=alert）", async () => {
    gitLogMock.fetchGitLogCommits.mockRejectedValue(
      makeApiError(504, "请求超时"),
    );
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("请求超时");
  });
});

// ── 正常数据 + 分页 ───────────────────────────────────────────────────

describe("Git 日志页正常态", () => {
  it("列表渲染 + 副标题已加载 N 条 + 加载更多 skip 递增", async () => {
    gitLogMock.fetchGitLogCommits.mockImplementation(
      async (_ws: string, skip: number) => {
        if (skip === 0) {
          return makeCommitsResponse({
            commits: [makeCommit(0), makeCommit(1), makeCommit(2)],
            has_more: true,
            total_in_window: 3,
          });
        }
        return makeCommitsResponse({
          commits: [makeCommit(3)],
          has_more: false,
          total_in_window: 1,
        });
      },
    );

    await withNonZeroViewport(async () => {
      renderPage();

      // 首页 3 条 + 副标题「已加载 3 条」（含工作区名）
      await waitFor(() => {
        expect(screen.getByText("提交信息 1")).toBeInTheDocument();
      });
      expect(
        screen.getByText(/演示工作区 · 已加载 3 条 · 全部分支/),
      ).toBeInTheDocument();
      expect(screen.getByRole("combobox")).toBeInTheDocument();

      // 加载更多：skip 递增到 100（PAGE_LIMIT=100）
      fireEvent.click(screen.getByRole("button", { name: /加载更多/ }));
      await waitFor(() => {
        expect(gitLogMock.fetchGitLogCommits).toHaveBeenCalledWith(
          "ws-1",
          100,
          100,
          "",
          "",
        );
      });

      // 第二页 has_more=false → 按钮隐藏，副标题更新为 4 条
      await waitFor(() => {
        expect(
          screen.queryByRole("button", { name: /加载更多/ }),
        ).not.toBeInTheDocument();
      });
      expect(screen.getByText(/已加载 4 条/)).toBeInTheDocument();
    });
  });

  it("has_more=false 首页即无「加载更多」按钮", async () => {
    gitLogMock.fetchGitLogCommits.mockResolvedValue(
      makeCommitsResponse({
        commits: [makeCommit(0)],
        has_more: false,
        total_in_window: 1,
      }),
    );
    await withNonZeroViewport(async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText("提交信息 0")).toBeInTheDocument();
      });
      expect(
        screen.queryByRole("button", { name: /加载更多/ }),
      ).not.toBeInTheDocument();
    });
  });
});

// ── WorkspaceTabs 注册（explorer-page.test.tsx 先例照抄）──────────────

describe("WorkspaceTabs「Git 日志」标签（task-06）", () => {
  it("TABS 增至 15 项，「Git 日志」末位且 href 为 /git-log", () => {
    render(
      <WorkspaceTabs workspaceId="ws-1">
        <div />
      </WorkspaceTabs>,
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(15);
    const labels = links.map((a) => a.textContent);
    const gitLogIdx = labels.indexOf("Git 日志");
    expect(gitLogIdx).toBe(labels.length - 1);
    expect(links[gitLogIdx]).toHaveAttribute("href", "/workspaces/ws-1/git-log");
  });

  it("当前在 /git-log 时「Git 日志」标签高亮", () => {
    render(
      <WorkspaceTabs workspaceId="ws-1">
        <div />
      </WorkspaceTabs>,
    );

    expect(
      screen.getByRole("link", { name: "Git 日志" }),
    ).toHaveAttribute("aria-current", "page");
  });
});
