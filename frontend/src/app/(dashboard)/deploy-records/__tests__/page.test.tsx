/**
 * 发布记录页测试（2026-10-14-deploy-release-notes task-04 / FR-05）。
 *
 * 覆盖：
 * 1. 列表渲染：序号/摘要/工作区/短SHA/commits 数/状态徽标（成功绿/失败红/invalid 灰）
 * 2. 首条默认选中 → 详情元数据行 + md 正文渲染
 * 3. 点击其它记录切换详情
 * 4. 空态 EmptyState
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// hooks 与 fetch 函数必须同工厂重建：actual 的 hook 闭包绑原 fetch 实现，
// 只 mock fetch 函数不生效（真实 apiFetch 在 jsdom 报错落入 error 态）。
vi.mock("@/lib/deploy-records", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const listDeployRecords = vi.fn();
  const getDeployRecord = vi.fn();
  return {
    listDeployRecords,
    getDeployRecord,
    useDeployRecordsList: () =>
      useQuery({ queryKey: ["deployRecords", "list"], queryFn: listDeployRecords, retry: false }),
    useDeployRecordDetail: (recordId: string | null) =>
      useQuery({
        queryKey: ["deployRecords", "detail", recordId],
        queryFn: () => getDeployRecord(recordId as string),
        enabled: recordId !== null,
        retry: false,
      }),
  };
});

// MarkdownPreview 是 dynamic(ssr:false) 异步组件，静态替换避免测试环境异步挂载
// （scan-docs-page.test 同款前置）。
vi.mock("@uiw/react-markdown-preview", () => ({
  default: ({ source }: { source?: string }) => <div data-testid="md-preview">{source}</div>,
}));

import DeployRecordsPage from "@/app/(dashboard)/deploy-records/page";
import { getDeployRecord, listDeployRecords } from "@/lib/deploy-records";

const mockList = listDeployRecords as unknown as ReturnType<typeof vi.fn>;
const mockDetail = getDeployRecord as unknown as ReturnType<typeof vi.fn>;

function summary(partial: Partial<Record<string, unknown>> & { record_id: string }) {
  return {
    workspace_id: "00000000-0000-0000-0000-000000000001",
    workspace_name: "SillyHub",
    file_name: "2026-10-14-003-ad6092e1d.md",
    seq: 3,
    status: "success",
    deployed_at: "2026-10-14 08:52:36",
    summary: "文件树显式同步",
    commit_from: "ebeb09af0",
    commit_to: "ad6092e1d",
    commits_count: 4,
    agent: "zcode-agent",
    ...partial,
  };
}

function detail(record_id: string, partial: Partial<Record<string, unknown>> = {}) {
  return {
    ...summary({ record_id }),
    content: "## 🆕 新增\n\n- sync 参数",
    ...partial,
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <DeployRecordsPage />
    </QueryClientProvider>,
  );
}

describe("DeployRecordsPage", () => {
  beforeEach(() => {
    vi.mocked(mockList).mockReset();
    vi.mocked(mockDetail).mockReset();
  });
  afterEach(cleanup);

  it("渲染列表：状态徽标 + 元数据 + 空值破折号", async () => {
    mockList.mockResolvedValue([
      summary({ record_id: "ws1/r3", status: "success" }),
      summary({ record_id: "ws1/r2", seq: 2, status: "failed", commits_count: null }),
      summary({ record_id: "ws1/r1", seq: 1, status: "invalid", deployed_at: null, seq_label: undefined, commit_to: null }),
    ]);
    mockDetail.mockResolvedValue(detail("ws1/r3"));
    renderPage();

    await waitFor(() => expect(screen.getByText("共 3 条")).toBeInTheDocument());
    expect(screen.getAllByText("文件树显式同步").length).toBeGreaterThan(0);
    expect(screen.getByText("成功")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByText("格式异常")).toBeInTheDocument();
    // invalid/空值统一破折号
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("首条默认选中：详情元数据 + md 正文渲染", async () => {
    mockList.mockResolvedValue([summary({ record_id: "ws1/r3" })]);
    mockDetail.mockResolvedValue(detail("ws1/r3"));
    renderPage();

    await waitFor(() => expect(screen.getByTestId("md-preview")).toBeInTheDocument());
    expect(screen.getByText(/sync 参数/)).toBeInTheDocument();
    expect(screen.getAllByText("SillyHub").length).toBeGreaterThan(0);
    expect(screen.getByText("ebeb09af0 → ad6092e1d")).toBeInTheDocument();
    expect(mockDetail).toHaveBeenCalledWith("ws1/r3");
  });

  it("点击其它记录切换详情", async () => {
    mockList.mockResolvedValue([
      summary({ record_id: "ws1/r3" }),
      summary({ record_id: "ws1/r2", seq: 2, summary: "断言面守卫" }),
    ]);
    mockDetail.mockResolvedValue(detail("ws1/r3"));
    renderPage();
    await waitFor(() => expect(screen.getByTestId("md-preview")).toBeInTheDocument());

    mockDetail.mockResolvedValue(detail("ws1/r2", { summary: "断言面守卫", content: "## 🔧 修复\n- 锚重算" }));
    fireEvent.click(screen.getByText("断言面守卫"));
    await waitFor(() =>
      expect(mockDetail).toHaveBeenLastCalledWith("ws1/r2"),
    );
    await waitFor(() => expect(screen.getByText(/锚重算/)).toBeInTheDocument());
  });

  it("空列表：EmptyState 引导文案", async () => {
    mockList.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText("暂无部署记录")).toBeInTheDocument());
    expect(screen.getByText(/docs\/releases/)).toBeInTheDocument();
  });
});
