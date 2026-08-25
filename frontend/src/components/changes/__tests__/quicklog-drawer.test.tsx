/**
 * 快速修复条目抽屉测试（task-09 / FR-06 / D-006）。
 *
 * 覆盖：
 *   1. 打开拉详情，四段正文 + 文件括注 + 关联变更链接渲染
 *   2. 「原始 md」切换：raw_block <pre> 直出 / 切回结构化视图
 *   3. 优雅降级：无正文段（暂无正文记录）/ 无文件（无）/ 无关联（无）
 *   4. 错误态（404 网络失败文案）
 *   5. task-12 关联会话卡挂载：结构化视图底部出现（数据源透传双 id、
 *      卡尾链接指向快速修复门户路由），原始 md 视图不出现
 *
 * mock 范式照 quicklog-table.test：importActual 部分 mock + QueryClientProvider。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuicklogDrawer } from "@/components/changes/quicklog-drawer";
import type { QuicklogEntryListItem, QuicklogEntryRead } from "@/lib/quicklog";

const mocks = vi.hoisted(() => ({
  getQuicklogDetail: vi.fn(),
  listQuicklogSessions: vi.fn(),
}));

vi.mock("@/lib/quicklog", async () => {
  const actual = await vi.importActual<typeof import("@/lib/quicklog")>(
    "@/lib/quicklog",
  );
  return { ...actual, getQuicklogDetail: mocks.getQuicklogDetail };
});

// task-12：抽屉底部挂载的关联会话卡数据源（部分 mock，默认空列表走空态）。
vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>(
    "@/lib/daemon",
  );
  return { ...actual, listQuicklogSessions: mocks.listQuicklogSessions };
});

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

function makeEntry(
  overrides: Partial<QuicklogEntryListItem> = {},
): QuicklogEntryListItem {
  return {
    ql_id: "ql-20260817-001-abcd",
    timestamp: "2026-08-17T01:30:00Z",
    title: "修侧栏宽度塌陷",
    status: "completed",
    status_note: null,
    placeholder: false,
    author_raw: "qinyi",
    author_name: "秦毅",
    linked_changes: [],
    files: [],
    affected_modules: [],
    source: "file",
    ...overrides,
  };
}

function makeDetail(
  overrides: Partial<QuicklogEntryRead> = {},
): QuicklogEntryRead {
  return {
    ql_id: "ql-20260817-001-abcd",
    timestamp: "2026-08-17T01:30:00Z",
    title: "修侧栏宽度塌陷",
    status: "completed",
    status_note: null,
    placeholder: false,
    author_raw: "qinyi",
    author_name: "秦毅",
    linked_changes: ["2026-08-16-change-center-quick-tab"],
    files: [
      { path: "frontend/src/components/changes/quicklog-table.tsx", note: "列表组件" },
      { path: "frontend/src/lib/quicklog.ts", note: null },
    ],
    affected_modules: ["frontend"],
    source: "file",
    body_sections: {
      需求: "侧栏 320px 塞宽内容卡挤崩。",
      根因: "md: 是视口断点非容器断点。",
      方案: "改宽 Dialog 入口卡。",
      结果: "vitest 39 用例绿。",
    },
    raw_block: "## ql-20260817-001-abcd | 01:30 | 修侧栏宽度塌陷\n状态：已完成",
    truncated: false,
    ...overrides,
  };
}

function renderDrawer(entry: QuicklogEntryListItem | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <QuicklogDrawer
        entry={entry}
        workspaceId="ws-1"
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.getQuicklogDetail.mockReset();
  mocks.listQuicklogSessions.mockReset();
  mocks.listQuicklogSessions.mockResolvedValue([]);
});

afterEach(cleanup);

describe("QuicklogDrawer", () => {
  it("打开拉详情：四段正文 + 文件括注 + 关联变更链接", async () => {
    mocks.getQuicklogDetail.mockResolvedValue(makeDetail());
    renderDrawer(makeEntry());

    // 四段正文
    expect(await screen.findByTestId("body-需求")).toBeTruthy();
    expect(screen.getByTestId("body-根因")).toBeTruthy();
    expect(screen.getByTestId("body-方案")).toBeTruthy();
    expect(screen.getByTestId("body-结果")).toBeTruthy();
    // 文件带括注；无括注文件不加
    expect(screen.getByText(/列表组件/)).toBeTruthy();
    // 关联变更链接（跳变更中心搜索）
    const link = screen.getByText("2026-08-16-change-center-quick-tab");
    expect(link.getAttribute("href")).toContain(
      "/workspaces/ws-1/changes?search=2026-08-16-change-center-quick-tab",
    );
    // 拉取参数
    expect(mocks.getQuicklogDetail).toHaveBeenCalledWith(
      "ws-1",
      "ql-20260817-001-abcd",
    );
    // task-12：结构化视图底部挂载关联会话卡——数据源透传双 id，卡尾链接
    // 指向快速修复门户路由（不带参），空列表走空态文案。
    expect(await screen.findByText("关联会话")).toBeInTheDocument();
    const portalLink = screen.getByRole("link", { name: "打开会话工作台" });
    expect(portalLink.getAttribute("href")).toBe(
      "/workspaces/ws-1/quicklog/ql-20260817-001-abcd/sessions",
    );
    await waitFor(() =>
      expect(mocks.listQuicklogSessions).toHaveBeenCalledWith(
        "ws-1",
        "ql-20260817-001-abcd",
      ),
    );
  });

  it("「原始 md」切换：Switch 开 → raw_block 直出，关 → 回结构化", async () => {
    mocks.getQuicklogDetail.mockResolvedValue(makeDetail());
    renderDrawer(makeEntry());

    await screen.findByTestId("body-需求");
    // 切到原始 md
    const sw = screen.getByTestId("raw-switch");
    fireEvent.click(sw);
    expect(await screen.findByText(/## ql-20260817-001-abcd/)).toBeTruthy();
    // 结构化视图隐藏（task-12：关联会话卡对齐 section 门控一并隐藏）
    expect(screen.queryByTestId("body-需求")).toBeNull();
    expect(screen.queryByText("关联会话")).toBeNull();
    // 切回
    fireEvent.click(sw);
    await waitFor(() =>
      expect(screen.getByTestId("body-需求")).toBeTruthy(),
    );
    expect(screen.queryByText(/## ql-20260817-001-abcd/)).toBeNull();
    // 关联会话卡随结构化视图恢复
    expect(screen.getByText("关联会话")).toBeTruthy();
  });

  it("优雅降级：无正文/无文件/无关联变更", async () => {
    mocks.getQuicklogDetail.mockResolvedValue(
      makeDetail({
        body_sections: {},
        files: [],
        linked_changes: [],
      }),
    );
    renderDrawer(makeEntry());

    expect(await screen.findByText("（暂无正文记录）")).toBeTruthy();
    await waitFor(() => {
      // 「（无）」两处（文件 + 关联变更）
      expect(screen.getAllByText("（无）").length).toBe(2);
    });
  });

  it("错误态：详情拉取失败显示错误文案", async () => {
    mocks.getQuicklogDetail.mockRejectedValue(
      new Error("快速修复条目不存在"),
    );
    renderDrawer(makeEntry());

    expect(await screen.findByText("加载快速修复详情失败")).toBeTruthy();
    // 列表项元信息仍在（标题不受详情失败影响）
    expect(screen.getByText("修侧栏宽度塌陷")).toBeTruthy();
  });
});
