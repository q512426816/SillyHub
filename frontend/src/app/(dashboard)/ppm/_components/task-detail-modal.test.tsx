// @author qinyi
// @created_at 2026-07-22
//
// task-13: TaskDetailModal 组件渲染单测 (任务计划执行附件, FR-02/03/04)。
//
// task 侧跨天拆分逻辑内联在 TaskDetailModal useEffect (非纯函数, 不同于
// problem-detail-modal 已提取 buildDetailDays), 故走组件渲染测:
//   1. 首天附件预填 (D-003): mock listTaskExecutes 返回 in-flight 带 file_urls →
//      填报区首天 FileUpload value 预填, 后续天 value 空。
//   2. 执行记录附件列回显 (D-004): records 带 file_urls → FileViewer 收到对应 id。
//   3. plan_task_id 守护 (D-002): task/problem 共用 TaskExecute 表, task 侧只传
//      plan_task_id (不传 problem_task_id)。
//   4. task=null → 不渲染。
//
// antd jsdom 坑 (参照 memory frontend-markdown-text-jsdom-null): FileViewer/
// FileUpload 内部用 antd Image.PreviewGroup / Upload 动态组件, jsdom 同步渲染
// 为 null, 且会触发 fetchFileMetaBatch 网络调用。此处 vi.mock 两个组件为纯
// 渲染 (把 fileIds/value 透出到 data-* 属性 + 文本), 既能断言又不依赖 antd
// 动态组件 / 网络。Modal 本身 (portal → document.body) 用 screen 查询。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, render } from "@testing-library/react";
import dayjs from "dayjs";

import { TaskDetailModal } from "@/app/(dashboard)/ppm/_components/task-detail-modal";
import type { PlanTask, TaskExecute } from "@/lib/ppm/types";

// 纯渲染 mock: 把 fileIds/value 透出到 data-* 属性 + 文本, 避开 antd 动态组件
// 与 fetchFileMetaBatch 网络调用 (jsdom 同步渲染为 null 坑)。
vi.mock("@/components/file-viewer", () => ({
  FileViewer: ({ fileIds = [] }: { fileIds?: string[] }) => (
    <span
      data-testid="file-viewer"
      data-fileids={(fileIds ?? []).join("|")}
    >
      附件:{(fileIds ?? []).join("|")}
    </span>
  ),
}));
vi.mock("@/components/file-upload", () => ({
  FileUpload: ({ value = [] }: { value?: string[] }) => (
    <span data-testid="file-upload" data-value={(value ?? []).join("|")}>
      已选:{(value ?? []).join("|")}
    </span>
  ),
}));

vi.mock("@/lib/ppm/task", () => ({
  listTaskExecutes: vi.fn(),
  startPlanTask: vi.fn(),
  executePlanTask: vi.fn(),
}));

// vi.mock hoisted 后, 真实 import 拿到 mock 版本
import { listTaskExecutes } from "@/lib/ppm/task";
const listTaskExecutesMock = vi.mocked(listTaskExecutes);

describe("TaskDetailModal — 首天附件预填 (D-003)", () => {
  beforeEach(() => {
    listTaskExecutesMock.mockReset();
  });

  it("in-flight 带 file_urls → 首天 FileUpload 预填, 后续天空 (跨2天)", async () => {
    // actual_start=昨天 → 今天, 跨2天 → 填报区2个 FileUpload
    const today = dayjs().startOf("day");
    const yesterday = today.subtract(1, "day").toISOString();
    listTaskExecutesMock.mockResolvedValue({
      items: [
        mkExecute({
          id: "ex1",
          plan_task_id: "t1",
          status: "30",
          actual_start_time: yesterday,
          file_urls: ["a", "b"],
          execute_info: "首日说明",
          time_spent: 1,
        }),
      ],
      total: 1,
      page: 1,
      page_size: 100,
    });
    render(
      <TaskDetailModal
        task={mkTask({ id: "t1", status: "进行中" })}
        mode="execute"
        onClose={() => undefined}
      />,
    );
    // 跨2天 → 填报区2个 FileUpload (每天一组附件)
    const uploads = await screen.findAllByTestId("file-upload");
    expect(uploads).toHaveLength(2);
    // D-003: 首天预填 in-flight 已有附件 (mock 以 "|" join)
    expect(uploads[0]?.getAttribute("data-value")).toBe("a|b");
    // 后续天空 (新记录未创建)
    expect(uploads[1]?.getAttribute("data-value")).toBe("");
  });

  it("in-flight file_urls 为空 → 首天 FileUpload 空 (单天)", async () => {
    const today = dayjs().startOf("day").toISOString();
    listTaskExecutesMock.mockResolvedValue({
      items: [
        mkExecute({
          id: "ex1",
          plan_task_id: "t1",
          status: "30",
          actual_start_time: today,
          file_urls: [],
          execute_info: "当天说明",
          time_spent: 0.5,
        }),
      ],
      total: 1,
      page: 1,
      page_size: 100,
    });
    render(
      <TaskDetailModal
        task={mkTask({ id: "t1", status: "进行中" })}
        mode="execute"
        onClose={() => undefined}
      />,
    );
    const uploads = await screen.findAllByTestId("file-upload");
    // 单天 → 1个 FileUpload, 空 (in-flight 无附件)
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.getAttribute("data-value")).toBe("");
  });
});

describe("TaskDetailModal — 执行记录附件列回显 (D-004)", () => {
  beforeEach(() => {
    listTaskExecutesMock.mockReset();
  });

  it("records 带 file_urls → 附件列 FileViewer 收到对应 id", async () => {
    listTaskExecutesMock.mockResolvedValue({
      items: [
        mkExecute({
          id: "ex1",
          plan_task_id: "t1",
          status: "40",
          actual_start_time: null,
          file_urls: ["rec1", "rec2"],
          execute_info: "开发了登录页",
          time_spent: 0.5,
        }),
      ],
      total: 1,
      page: 1,
      page_size: 100,
    });
    render(
      <TaskDetailModal
        task={mkTask({ id: "t1", status: "进行中" })}
        mode="detail"
        onClose={() => undefined}
      />,
    );
    await waitFor(() => {
      expect(listTaskExecutesMock).toHaveBeenCalled();
    });
    // D-004: 记录行 FileViewer 收到记录附件 id
    await waitFor(() => {
      const viewers = screen.getAllByTestId("file-viewer");
      expect(
        viewers.some((v) => v.getAttribute("data-fileids") === "rec1|rec2"),
      ).toBe(true);
    });
  });
});

describe("TaskDetailModal — 挂载行为", () => {
  beforeEach(() => {
    listTaskExecutesMock.mockReset();
  });

  it("task=null → 不渲染 (container 为空)", () => {
    const { container } = render(
      <TaskDetailModal task={null} mode="detail" onClose={() => undefined} />,
    );
    expect(container.textContent).toBe("");
  });

  it("挂载 → 用 plan_task_id 拉执行记录 (D-002: 非 problem_task_id)", async () => {
    listTaskExecutesMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 100,
    });
    render(
      <TaskDetailModal
        task={mkTask({ id: "t1" })}
        mode="execute"
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
    // 守护: plan/problem 共用 TaskExecute 表, task 侧只该传 plan_task_id
    const callArg = listTaskExecutesMock.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(callArg?.problem_task_id).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function mkTask(over: Partial<PlanTask> & { id: string }): PlanTask {
  return {
    id: over.id,
    user_id: over.user_id ?? "u1",
    user_name: over.user_name ?? "张三",
    status: over.status ?? "未开始",
    month: over.month ?? null,
    week: over.week ?? null,
    year: over.year ?? null,
    week_day: over.week_day ?? null,
    start_time: over.start_time ?? null,
    end_time: over.end_time ?? null,
    project_id: over.project_id ?? "proj-1",
    project_name: over.project_name ?? "项目甲",
    module_id: over.module_id ?? null,
    module_name: over.module_name ?? null,
    content: over.content ?? "任务A",
    task_description: over.task_description ?? null,
    work_load: over.work_load ?? "2",
    add_work: over.add_work ?? null,
    work_partner: over.work_partner ?? null,
    remarks: over.remarks ?? null,
    no: over.no ?? null,
    ps_plan_node_detail_id: over.ps_plan_node_detail_id ?? null,
    actual_start_time: over.actual_start_time ?? null,
    actual_end_time: over.actual_end_time ?? null,
    start_remark: over.start_remark ?? null,
    end_remark: over.end_remark ?? null,
    time_spent: over.time_spent ?? null,
    plan_attach_group_id: over.plan_attach_group_id ?? null,
    file_urls: over.file_urls ?? [],
    kanban_order: over.kanban_order ?? 0,
    created_at: over.created_at ?? "2026-07-01T00:00:00Z",
    updated_at: over.updated_at ?? "2026-07-01T00:00:00Z",
    spent_time: over.spent_time,
  };
}

function mkExecute(over: Partial<TaskExecute> & { id: string }): TaskExecute {
  return {
    id: over.id,
    plan_task_id: over.plan_task_id ?? null,
    problem_task_id: over.problem_task_id ?? null,
    time_spent: over.time_spent ?? null,
    actual_start_time: over.actual_start_time ?? null,
    actual_end_time: over.actual_end_time ?? null,
    start_remark: over.start_remark ?? null,
    end_remark: over.end_remark ?? null,
    execute_info: over.execute_info ?? null,
    attach_group_id: over.attach_group_id ?? null,
    file_urls: over.file_urls ?? [],
    execute_user_id: over.execute_user_id ?? null,
    check_info: over.check_info ?? null,
    check_attach_group_id: over.check_attach_group_id ?? null,
    check_user_id: over.check_user_id ?? null,
    check_flag: over.check_flag ?? null,
    current_user_id: over.current_user_id ?? null,
    status: over.status ?? "30",
    created_at: over.created_at ?? "2026-07-20T09:00:00Z",
    updated_at: over.updated_at ?? "2026-07-20T12:00:00Z",
  };
}
