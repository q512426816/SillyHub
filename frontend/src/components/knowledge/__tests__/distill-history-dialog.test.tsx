/**
 * 提炼记录弹层测试（ql-20260918-002）。
 *
 * 惯例（同 distill-task-bar.test）：@/lib/knowledge mock（vi.hoisted）+
 * QueryClientProvider retry:false；next/navigation mock（查看会话深链）；
 * Radix Dialog 直接渲染（组件测试无 antd Tree :has() 崩溃面）。
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DistillHistoryDialog } from "@/components/knowledge/distill-history-dialog";
import type { DistillTaskRead } from "@/lib/knowledge";

const mocks = vi.hoisted(() => ({ listDistillTasks: vi.fn() }));
vi.mock("@/lib/knowledge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/knowledge")>()),
  listDistillTasks: mocks.listDistillTasks,
}));

const pushMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
}));

const WS = "ws-1";

function task(p: Partial<DistillTaskRead> & { agent_run_id: string }): DistillTaskRead {
  return {
    source_type: "session",
    source_ref: "9a8b7c6d-1111-2222-3333-444455556666",
    status: "completed",
    created_at: "2026-09-18T02:00:00Z",
    mode: "fresh",
    ...p,
  };
}

let queryClient: QueryClient;

function renderDialog(
  props: Partial<Parameters<typeof DistillHistoryDialog>[0]> = {},
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <DistillHistoryDialog
        workspaceId={WS}
        open
        onOpenChange={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe("DistillHistoryDialog", () => {
  it("列出历史任务（状态徽标/来源摘要/时间），请求带工作区 id", async () => {
    mocks.listDistillTasks.mockResolvedValue([
      task({ agent_run_id: "r-1", status: "failed", degraded_reason: "provider_no_resume" }),
      task({ agent_run_id: "r-2", source_type: "quick", source_ref: '["ql-1","ql-2"]' }),
    ]);
    renderDialog();

    const items = await screen.findAllByTestId("distill-history-item");
    expect(items).toHaveLength(2);
    expect(mocks.listDistillTasks).toHaveBeenCalledWith(WS);
    expect(items[0]).toHaveTextContent("失败");
    expect(items[0]).toHaveTextContent("引擎不支持续接");
    expect(items[1]).toHaveTextContent("快速修复 · 2 条记录");
  });

  it("查看会话：agent_session_id 非空点击深链 /sessions?session=<id> 并关弹层", async () => {
    const onOpenChange = vi.fn();
    mocks.listDistillTasks.mockResolvedValue([
      task({ agent_run_id: "r-1", agent_session_id: "sess-h-1" }),
    ]);
    renderDialog({ onOpenChange });

    fireEvent.click(await screen.findByTestId("distill-history-session"));
    expect(pushMock).toHaveBeenCalledWith("/sessions?session=sess-h-1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("已合并条目：点击反链回调 merged_to 文件段并关弹层", async () => {
    const onOpenChange = vi.fn();
    const onJumpToEntry = vi.fn();
    mocks.listDistillTasks.mockResolvedValue([
      task({ agent_run_id: "r-1", merged_to: "known-issues.md#某小节" }),
    ]);
    renderDialog({ onOpenChange, onJumpToEntry });

    fireEvent.click(await screen.findByTestId("distill-history-merged"));
    expect(onJumpToEntry).toHaveBeenCalledWith("known-issues.md");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("无历史记录空态；加载失败错误态", async () => {
    mocks.listDistillTasks.mockResolvedValue([]);
    const { unmount } = renderDialog();
    await waitFor(() =>
      expect(screen.getByText(/还没有提炼记录/)).toBeInTheDocument(),
    );
    unmount();

    mocks.listDistillTasks.mockRejectedValue(new Error("boom"));
    renderDialog();
    await waitFor(() => expect(screen.getByText(/加载失败/)).toBeInTheDocument());
  });
});
