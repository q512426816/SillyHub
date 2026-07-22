// ql-20260722-002: 看板抽屉「子任务」tab → 「执行记录」tab(只读)单测。
//
// 覆盖:
//   1. 挂载 → 用 plan_task_id: task.id (page=1,page_size=100) 拉执行记录
//      (KanbanTaskCard.id 即 PlanTask.id, 直接当 plan_task_id)
//   2. 空数据 → 显示「暂无执行记录」
//   3. 有数据 → 渲染执行记录表格行(说明/耗时可见)
//   4. 不再出现「子任务」tab(子任务死代码已移除)
//   5. task=null → 不拉接口
//
// 测试边界(对齐 problem-detail-modal.test.tsx 哲学):
//   只读展示,无跨天填报,故不测 start/execute 提交序列。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, render } from "@testing-library/react";

import { KanbanTaskDetailDrawer } from "@/app/(dashboard)/ppm/kanban/_components/kanban-task-detail-drawer";
import type { KanbanTaskCard } from "@/lib/ppm/types";

vi.mock("@/lib/ppm/kanban", () => ({
  listKanbanComments: vi.fn(),
  addKanbanComment: vi.fn(),
}));
vi.mock("@/lib/ppm/task", () => ({
  listTaskExecutes: vi.fn(),
}));

// vi.mock hoisted 后真实 import 拿到 mock 版本
import { listKanbanComments } from "@/lib/ppm/kanban";
import { listTaskExecutes } from "@/lib/ppm/task";
const listTaskExecutesMock = vi.mocked(listTaskExecutes);
const listKanbanCommentsMock = vi.mocked(listKanbanComments);

describe("KanbanTaskDetailDrawer — 执行记录 tab(只读)", () => {
  beforeEach(() => {
    listTaskExecutesMock.mockReset();
    listKanbanCommentsMock.mockReset();
    listKanbanCommentsMock.mockResolvedValue([]);
  });

  it("task=null → 不拉接口", () => {
    render(<KanbanTaskDetailDrawer task={null} onClose={() => undefined} />);
    expect(listTaskExecutesMock).not.toHaveBeenCalled();
    expect(listKanbanCommentsMock).not.toHaveBeenCalled();
  });

  it("挂载 → 用 plan_task_id: task.id (page=1,size=100) 拉执行记录", async () => {
    listTaskExecutesMock.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
    render(
      <KanbanTaskDetailDrawer
        task={mkTask({ id: "t1" })}
        onClose={() => undefined}
      />,
    );
    await waitFor(() => {
      expect(listTaskExecutesMock).toHaveBeenCalledWith({
        plan_task_id: "t1",
        page: 1,
        page_size: 100,
      });
    });
    // 守护: plan/problem 共用 TaskExecute 表, 看板任务只该传 plan_task_id
    const callArg = listTaskExecutesMock.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(callArg?.problem_task_id).toBeUndefined();
  });

  it("空数据 → 显示「暂无执行记录」", async () => {
    listTaskExecutesMock.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
    render(
      <KanbanTaskDetailDrawer
        task={mkTask({ id: "t1" })}
        onClose={() => undefined}
      />,
    );
    await waitFor(() => {
      expect(listTaskExecutesMock).toHaveBeenCalled();
    });
    expect(await screen.findByText("暂无执行记录")).toBeInTheDocument();
  });

  it("有数据 → 渲染执行记录行(说明 + 耗时可见)", async () => {
    listTaskExecutesMock.mockResolvedValue({
      items: [
        {
          id: "ex1",
          plan_task_id: "t1",
          problem_task_id: null,
          time_spent: 0.5,
          actual_start_time: "2026-07-20T09:00:00Z",
          actual_end_time: "2026-07-20T12:00:00Z",
          start_remark: null,
          end_remark: null,
          execute_info: "开发登录页",
          attach_group_id: null,
          execute_user_id: null,
          check_info: null,
          check_attach_group_id: null,
          check_user_id: null,
          check_flag: null,
          current_user_id: null,
          status: "30",
          created_at: "2026-07-20T09:00:00Z",
          updated_at: "2026-07-20T12:00:00Z",
        },
      ],
      total: 1,
      page: 1,
      page_size: 100,
    });
    render(
      <KanbanTaskDetailDrawer
        task={mkTask({ id: "t1" })}
        onClose={() => undefined}
      />,
    );
    // 说明文本应出现在执行记录表里
    expect(await screen.findByText("开发登录页")).toBeInTheDocument();
    // 耗时渲染为「0.5人天」
    expect(screen.getByText("0.5人天")).toBeInTheDocument();
    // 不应再显示空态
    expect(screen.queryByText("暂无执行记录")).not.toBeInTheDocument();
  });

  it("不再出现「子任务」tab(死代码已移除)", async () => {
    listTaskExecutesMock.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
    render(
      <KanbanTaskDetailDrawer
        task={mkTask({ id: "t1" })}
        onClose={() => undefined}
      />,
    );
    await waitFor(() => {
      expect(listTaskExecutesMock).toHaveBeenCalled();
    });
    expect(screen.queryByText("子任务")).not.toBeInTheDocument();
    // 评论 / 附件 tab 仍保留
    expect(screen.getByText("评论")).toBeInTheDocument();
    expect(screen.getByText("附件")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function mkTask(over: Partial<KanbanTaskCard> & { id: string }): KanbanTaskCard {
  return {
    id: over.id,
    title: over.title ?? "看板任务A",
    status: over.status ?? "进行中",
    project_id: over.project_id ?? "proj-1",
    project_name: over.project_name ?? "项目甲",
    user_id: over.user_id ?? "u1",
    user_name: over.user_name ?? "张三",
    deadline: over.deadline ?? "2026-07-25",
    start_time: over.start_time ?? "2026-07-20",
    priority: over.priority ?? 2,
    progress: over.progress ?? 50,
    create_time: over.create_time ?? "2026-07-20T00:00:00Z",
    update_time: over.update_time ?? "2026-07-20T00:00:00Z",
    estimate_hours: over.estimate_hours ?? 3,
    task_description: over.task_description ?? null,
    module_name: over.module_name ?? null,
    work_partner: over.work_partner ?? null,
    remarks: over.remarks ?? null,
    kanban_order: over.kanban_order ?? 0,
    file_urls: over.file_urls ?? [],
  };
}
