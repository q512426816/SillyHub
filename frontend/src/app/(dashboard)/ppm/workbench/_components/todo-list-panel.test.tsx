/** TodoListPanel 分页 + 切换跟随单测 (task-12 / FR-01)。 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent, render } from "@testing-library/react";

import { TodoListPanel } from "@/app/(dashboard)/ppm/workbench/_components/todo-list-panel";

vi.mock("@/lib/ppm/workbench", () => ({
  fetchWorkbenchTodos: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { fetchWorkbenchTodos } from "@/lib/ppm/workbench";
const fetchMock = vi.mocked(fetchWorkbenchTodos);

function pageResp(items: { id: string; name: string }[], total: number) {
  return {
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      type: "任务",
      source: "plan_task",
    })),
    total,
    page: 1,
    page_size: 10,
  };
}

describe("TodoListPanel — 分页 + 切换跟随", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("渲染首页 10 条 + badge=total + 共 N 条", async () => {
    fetchMock.mockResolvedValue(
      pageResp(Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, name: `任务${i}` })), 23),
    );
    render(<TodoListPanel />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(null, 1, 10));
    expect(await screen.findByText("任务0")).toBeTruthy();
    expect(screen.getByText("23")).toBeTruthy(); // badge total
    expect(screen.getByText(/共 23 条/)).toBeTruthy();
  });

  it("点「下一页」→ 以 page=2 请求", async () => {
    fetchMock.mockResolvedValue(pageResp([], 23));
    render(<TodoListPanel />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(null, 1, 10));
    fireEvent.click(screen.getByText("下一页"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(null, 2, 10));
  });

  it("targetUserId 变化 → 重置到 page=1 请求", async () => {
    fetchMock.mockResolvedValue(pageResp([], 5));
    const { rerender } = render(<TodoListPanel targetUserId={null} />);
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(null, 1, 10));
    rerender(<TodoListPanel targetUserId="user-xyz" />);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith("user-xyz", 1, 10),
    );
  });

  it("空数据 → 显示「暂无待办」", async () => {
    fetchMock.mockResolvedValue(pageResp([], 0));
    render(<TodoListPanel />);
    expect(await screen.findByText("暂无待办")).toBeTruthy();
  });
});
