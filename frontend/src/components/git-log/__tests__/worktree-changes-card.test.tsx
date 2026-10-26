/**
 * task-04（2026-10-25-explorer-git-status）：「工作区更改」卡测试（三分组 /
 * 四色 / 计数 / 刷新 / 降级态 / 点击回调）。
 *
 * 覆盖（tasks/task-04.md acceptance + design §Phase 3 / D-002 / D-007 / R-06）：
 * 1. 三分组渲染归属：modified/added/deleted → 「更改」组（含 HEAD 基线说明）、
 *    untracked → 「未纳入版本管理」组、ignored → 「已忽略」组（顶层聚合行）；
 *    分组可点击折叠——untracked/ignored 默认收起、更改默认展开
 *    （2026-10-26-worktree-group-collapse，用户实测反馈）；
 * 2. 四色类名（D-002）：新增/新文件=text-success、修改=text-primary、删除=
 *    text-error line-through、忽略=text-muted-foreground；
 * 3. untracked 无行数仅「新文件」徽标（R-06）；modified 行 +N/−N；
 * 4. 卡头汇总计数徽标（N 处修改 / N 删除 / N 新文件 / 忽略 N 项（聚合））；
 * 5. 刷新按钮 invalidate 前缀 → active 查询 refetch（apiFetch 计数增加）；
 * 6. 边界：空清单「工作区干净」/ 空仓库「还没有任何提交」/ 加载态 / 错误分型
 *    （422 升级 daemon 引导 / 502 离线）/ no_git 渲染 null；
 * 7. 点击文件行 onOpenFile(path, status)；忽略行不可点击。
 *
 * mock 策略对齐 git-status-bar.test.tsx：不 mock @/lib/git-log（真实
 * react-query 缓存，刷新 invalidate 断言才有意义），仅 mock @/lib/api 的
 * apiFetch（ApiError 等 actual 透传）。
 *
 * 依据：tasks/task-04.md、design.md §Phase 3、prototype-explorer-git-status.html ①。
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  WorktreeChangesCard,
  WORKTREE_STATUS_META,
} from "@/components/git-log/worktree-changes-card";
import type { GitDirtyFilesResponse } from "@/lib/git-log";

// ── mock @/lib/api：只换 apiFetch（请求计数 = mock 计数）────────────────

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: apiFetchMock };
});

// ── fixture（design §接口定义全字段）────────────────────────────────────

function makeDirtyFiles(
  overrides: Partial<GitDirtyFilesResponse> = {},
): GitDirtyFilesResponse {
  return {
    git_mode: "git",
    head_short: "a9f5fae1",
    empty: false,
    files: [
      {
        path: "frontend/src/components/explorer/file-explorer.tsx",
        status: "modified",
        additions: 42,
        deletions: 7,
        binary: false,
      },
      {
        path: "frontend/src/lib/legacy-search.ts",
        status: "deleted",
        additions: 0,
        deletions: 88,
        binary: false,
      },
      {
        path: "backend/app/modules/git_log/router.py",
        status: "added",
        additions: 56,
        deletions: null,
        binary: false,
      },
      {
        path: "docs/设计 文档.md",
        status: "untracked",
        additions: null,
        deletions: null,
        binary: false,
      },
      {
        path: "assets/logo.png",
        status: "modified",
        additions: null,
        deletions: null,
        binary: true,
      },
    ],
    ignored: [
      { path: "node_modules/", is_dir: true },
      { path: ".env", is_dir: false },
    ],
    ...overrides,
  };
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderCard(
  dataOrImpl: GitDirtyFilesResponse | (() => never) | Promise<never>,
  onOpenFile = vi.fn(),
) {
  const client = makeClient();
  apiFetchMock.mockImplementation(() => {
    if (typeof dataOrImpl === "function") return dataOrImpl();
    if (dataOrImpl instanceof Promise) return dataOrImpl;
    return Promise.resolve(dataOrImpl);
  });
  const view = render(
    <QueryClientProvider client={client}>
      <WorktreeChangesCard workspaceId="ws-1" onOpenFile={onOpenFile} />
    </QueryClientProvider>,
  );
  return { client, view, onOpenFile };
}

describe("WorktreeChangesCard — 三分组与四色（task-04）", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("三分组渲染归属：更改组含 HEAD 基线说明、untracked 独立组、ignored 聚合组", async () => {
    renderCard(makeDirtyFiles());
    await waitFor(() => {
      expect(screen.getByTestId("worktree-changes-card")).toBeInTheDocument();
    });
    // 更改组默认展开：modified/added/deleted 三行 + 基线说明。
    const changed = screen.getByTestId("worktree-group-changed");
    expect(changed).toHaveTextContent("对比基线：最近一次提交 a9f5fae1");
    expect(
      screen.getByTestId("worktree-file-frontend/src/components/explorer/file-explorer.tsx"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("worktree-file-frontend/src/lib/legacy-search.ts")).toBeInTheDocument();
    expect(screen.getByTestId("worktree-file-backend/app/modules/git_log/router.py")).toBeInTheDocument();
    // untracked 独立组：默认收起，展开后行可见。
    const untracked = screen.getByTestId("worktree-group-untracked");
    expect(untracked).toHaveTextContent("未纳入版本管理");
    fireEvent.click(screen.getByTestId("worktree-group-toggle-untracked"));
    expect(screen.getByTestId("worktree-file-docs/设计 文档.md")).toBeInTheDocument();
    // ignored 聚合组：默认收起，展开后目录与散落单文件各一行。
    const ignored = screen.getByTestId("worktree-group-ignored");
    expect(ignored).toHaveTextContent("已忽略");
    fireEvent.click(screen.getByTestId("worktree-group-toggle-ignored"));
    expect(screen.getByTestId("worktree-ignored-node_modules/")).toHaveTextContent("目录整体");
    expect(screen.getByTestId("worktree-ignored-.env")).toBeInTheDocument();
  });

  it("分组折叠（2026-10-26-worktree-group-collapse）：untracked/ignored 默认收起、更改默认展开、点击切换", async () => {
    renderCard(makeDirtyFiles());
    await waitFor(() => {
      expect(screen.getByTestId("worktree-changes-card")).toBeInTheDocument();
    });
    // 默认态：更改展开（aria-expanded=true），另两组收起且内容不在 DOM。
    expect(screen.getByTestId("worktree-group-toggle-changed")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const untrackedToggle = screen.getByTestId("worktree-group-toggle-untracked");
    const ignoredToggle = screen.getByTestId("worktree-group-toggle-ignored");
    expect(untrackedToggle).toHaveAttribute("aria-expanded", "false");
    expect(ignoredToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("worktree-file-docs/设计 文档.md")).not.toBeInTheDocument();
    expect(screen.queryByTestId("worktree-ignored-node_modules/")).not.toBeInTheDocument();
    // 收起态头行仍带计数，收起不丢信息量。
    expect(untrackedToggle).toHaveTextContent("1 个文件");
    expect(ignoredToggle).toHaveTextContent("2 项");
    // 点击展开 → 内容出现；再点收起 → 内容消失、aria 翻回。
    fireEvent.click(untrackedToggle);
    expect(screen.getByTestId("worktree-file-docs/设计 文档.md")).toBeInTheDocument();
    fireEvent.click(untrackedToggle);
    expect(screen.queryByTestId("worktree-file-docs/设计 文档.md")).not.toBeInTheDocument();
    expect(untrackedToggle).toHaveAttribute("aria-expanded", "false");
    // 更改组同样可收起。
    fireEvent.click(screen.getByTestId("worktree-group-toggle-changed"));
    expect(
      screen.queryByTestId("worktree-file-frontend/src/components/explorer/file-explorer.tsx"),
    ).not.toBeInTheDocument();
  });

  it("四色类名（D-002）：修改蓝 / 新增绿 / 删除红+删除线 / 新文件绿 / 忽略灰", async () => {
    renderCard(makeDirtyFiles());
    await waitFor(() => {
      expect(screen.getByTestId("worktree-changes-card")).toBeInTheDocument();
    });
    // untracked/ignored 默认收起，展开后再断言行颜色。
    fireEvent.click(screen.getByTestId("worktree-group-toggle-untracked"));
    fireEvent.click(screen.getByTestId("worktree-group-toggle-ignored"));
    const rowOf = (testId: string) =>
      screen.getByTestId(testId).querySelector("span.font-mono");
    expect(rowOf("worktree-file-frontend/src/components/explorer/file-explorer.tsx")).toHaveClass(
      "text-primary",
    );
    expect(rowOf("worktree-file-backend/app/modules/git_log/router.py")).toHaveClass(
      "text-success",
    );
    const deleted = rowOf("worktree-file-frontend/src/lib/legacy-search.ts");
    expect(deleted).toHaveClass("text-error");
    expect(deleted).toHaveClass("line-through");
    expect(rowOf("worktree-file-docs/设计 文档.md")).toHaveClass("text-success");
    expect(
      screen.getByTestId("worktree-ignored-.env").querySelector("span.font-mono"),
    ).toHaveClass("text-muted-foreground");
  });

  it("untracked 无行数仅「新文件」徽标（R-06）；modified 行 +N/−N", async () => {
    renderCard(makeDirtyFiles());
    await waitFor(() => {
      expect(screen.getByTestId("worktree-changes-card")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("worktree-group-toggle-untracked"));
    const untrackedRow = screen.getByTestId("worktree-file-docs/设计 文档.md");
    expect(untrackedRow).toHaveTextContent("新文件");
    expect(untrackedRow.textContent).not.toMatch(/\+\d/);
    const modifiedRow = screen.getByTestId(
      "worktree-file-frontend/src/components/explorer/file-explorer.tsx",
    );
    expect(modifiedRow).toHaveTextContent("+42");
    expect(modifiedRow).toHaveTextContent("−7");
    // 二进制行：行数 null 不显示，仅「二进制」+「修改」徽标。
    const binaryRow = screen.getByTestId("worktree-file-assets/logo.png");
    expect(binaryRow).toHaveTextContent("二进制");
    expect(binaryRow.textContent).not.toMatch(/\+\d/);
  });

  it("卡头汇总计数：1 处修改(非 deleted/added) + 1 删除 + 2 新文件(含 untracked) + 忽略 2 项", async () => {
    renderCard(makeDirtyFiles());
    await waitFor(() => {
      expect(screen.getByTestId("worktree-changes-card")).toBeInTheDocument();
    });
    const header = screen.getByTestId("worktree-changes-card").querySelector("div");
    expect(screen.getByText("2 处修改")).toBeInTheDocument();
    expect(screen.getByText("1 删除")).toBeInTheDocument();
    expect(screen.getByText("2 新文件")).toBeInTheDocument();
    expect(screen.getByText("忽略 2 项（聚合）")).toBeInTheDocument();
    expect(header).toBeTruthy();
  });

  it("点击文件行 → onOpenFile(path, status)；忽略行无点击语义", async () => {
    const onOpenFile = vi.fn();
    renderCard(makeDirtyFiles(), onOpenFile);
    await waitFor(() => {
      expect(screen.getByTestId("worktree-changes-card")).toBeInTheDocument();
    });
    fireEvent.click(
      screen.getByTestId("worktree-file-frontend/src/lib/legacy-search.ts"),
    );
    expect(onOpenFile).toHaveBeenCalledWith(
      "frontend/src/lib/legacy-search.ts",
      "deleted",
    );
    fireEvent.click(screen.getByTestId("worktree-group-toggle-untracked"));
    fireEvent.click(screen.getByTestId("worktree-file-docs/设计 文档.md"));
    expect(onOpenFile).toHaveBeenCalledWith("docs/设计 文档.md", "untracked");
  });

  it("刷新按钮 invalidate 前缀 → active 查询 refetch（apiFetch 二次调用）", async () => {
    renderCard(makeDirtyFiles());
    await waitFor(() => {
      expect(screen.getByTestId("worktree-changes-card")).toBeInTheDocument();
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("worktree-changes-refresh"));
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledTimes(2);
    });
  });
});

describe("WorktreeChangesCard — 边界与降级态（task-04）", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("空清单（files/ignored 全空，非空仓库）→ 「工作区干净」轻提示", async () => {
    renderCard(
      makeDirtyFiles({ files: [], ignored: [], head_short: "a9f5fae1" }),
    );
    await waitFor(() => {
      expect(screen.getByText("工作区干净，没有未提交的更改。")).toBeInTheDocument();
    });
  });

  it("空仓库（empty=true）→ 「还没有任何提交」提示", async () => {
    renderCard(
      makeDirtyFiles({
        files: [],
        ignored: [],
        head_short: null,
        empty: true,
      }),
    );
    await waitFor(() => {
      expect(screen.getByText("仓库还没有任何提交——第一次提交后这里会显示工作区更改。")).toBeInTheDocument();
    });
  });

  it("加载态 → 「正在读取工作区更改…」", async () => {
    renderCard(new Promise<never>(() => undefined)); // 永不 resolve
    expect(screen.getByTestId("worktree-changes-loading")).toBeInTheDocument();
  });

  it("错误 422 → daemon 版本过旧引导文案", async () => {
    const { ApiError } = (await vi.importActual("@/lib/api")) as typeof import("@/lib/api");
    apiFetchMock.mockImplementation(() =>
      Promise.reject(
        new ApiError(422, { code: "HTTP_422_GIT_LOG_DAEMON_TOO_OLD", message: "版本过旧", request_id: null, details: null }),
      ),
    );
    const client = makeClient();
    render(
      <QueryClientProvider client={client}>
        <WorktreeChangesCard workspaceId="ws-1" onOpenFile={vi.fn()} />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("worktree-changes-error")).toHaveTextContent(
        "本机 daemon 版本过旧，不支持工作区文件状态查询，请升级 daemon。",
      );
    });
  });

  it("错误 502 → 离线降级文案", async () => {
    const { ApiError } = (await vi.importActual("@/lib/api")) as typeof import("@/lib/api");
    apiFetchMock.mockImplementation(() =>
      Promise.reject(
        new ApiError(502, { code: "HTTP_502_GIT_LOG_DAEMON_OFFLINE", message: "离线", request_id: null, details: null }),
      ),
    );
    const client = makeClient();
    render(
      <QueryClientProvider client={client}>
        <WorktreeChangesCard workspaceId="ws-1" onOpenFile={vi.fn()} />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("worktree-changes-error")).toHaveTextContent(
        "本机守护进程离线或超时",
      );
    });
  });

  it("no_git → 组件渲染 null（页面空态卡不堆叠）", async () => {
    const { container } = (() => {
      const client = makeClient();
      apiFetchMock.mockImplementation(() =>
        Promise.resolve(makeDirtyFiles({ git_mode: "no_git", files: [], ignored: [] })),
      );
      const view = render(
        <QueryClientProvider client={client}>
          <WorktreeChangesCard workspaceId="ws-1" onOpenFile={vi.fn()} />
        </QueryClientProvider>,
      );
      return { container: view.container };
    })();
    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });
});

describe("WORKTREE_STATUS_META — D-002 语义色导出", () => {
  it("四态+ignored 全键齐全，删除态含 line-through", () => {
    expect(WORKTREE_STATUS_META.modified.text).toBe("text-primary");
    expect(WORKTREE_STATUS_META.added.text).toBe("text-success");
    expect(WORKTREE_STATUS_META.untracked.text).toBe("text-success");
    expect(WORKTREE_STATUS_META.deleted.text).toContain("text-error");
    expect(WORKTREE_STATUS_META.deleted.text).toContain("line-through");
    expect(WORKTREE_STATUS_META.ignored.text).toBe("text-muted-foreground");
  });
});
