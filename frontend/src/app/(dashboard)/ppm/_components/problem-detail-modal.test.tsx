// task-13: problem-detail-modal 单测 (问题清单对齐任务计划, 2026-07-20)。
//
// 覆盖:
//   1. buildDetailDays 跨天拆分纯函数 (从 modal 提取以便单测, 核心算法):
//      - inflight null / actual_start_time null → []
//      - 单天 (start==today) → 1 条
//      - 跨 N 天 → N 条, 首条预填 inflight 的 time_spent/execute_info, 后续空
//      - 超过 60 天截断 (兜底防死循环)
//      - start 在未来 → [] (异常数据)
//   2. ProblemDetailModal 挂载 → 用 problem_task_id 拉执行记录 (非 plan_task_id,
//      D-002 plan/problem 共用 TaskExecute 表, 靠 problem_task_id 互斥区分)
//   3. problem=null 不渲染
//
// 测试边界 (对齐 milestone-details.test.tsx 哲学):
//   - vitest jsdom 下 antd Modal/Dashboard 提交序列易碎, 此处不触发完整跨天
//     提交 (那依赖 Modal portal + 异步 start+execute 序列), 由后端
//     test_problem_flow (start/execute/跨天校验) + 人工 e2e 覆盖。
//   - 跨天拆分算法是肉眼最难核对的逻辑, 用纯函数测试充分覆盖。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { waitFor, render } from "@testing-library/react";
import dayjs from "dayjs";

import {
  buildDetailDays,
  ProblemDetailModal,
} from "@/app/(dashboard)/ppm/_components/problem-detail-modal";
import type { ProblemList } from "@/lib/ppm";

vi.mock("@/lib/ppm/task", () => ({
  listTaskExecutes: vi.fn(),
}));
vi.mock("@/lib/ppm/problem", () => ({
  startProblem: vi.fn(),
  executeProblem: vi.fn(),
}));

// vi.mock hoisted 后, 真实 import 拿到 mock 版本
import { listTaskExecutes } from "@/lib/ppm/task";
const listTaskExecutesMock = vi.mocked(listTaskExecutes);

const TODAY = dayjs("2026-07-20").startOf("day");

// ---------------------------------------------------------------------------
// buildDetailDays — 跨天拆分纯函数
// ---------------------------------------------------------------------------

describe("buildDetailDays — 跨天拆分纯函数", () => {
  it("inflight null → []", () => {
    expect(buildDetailDays(null, TODAY)).toEqual([]);
  });

  it("actual_start_time null → [] (无有效开始时间)", () => {
    expect(
      buildDetailDays(
        { actual_start_time: null, time_spent: 1, execute_info: "x" },
        TODAY,
      ),
    ).toEqual([]);
  });

  it("start == today → 单条 (当天开始当天填)", () => {
    const r = buildDetailDays(
      {
        actual_start_time: "2026-07-20T10:00:00Z",
        time_spent: null,
        execute_info: null,
      },
      TODAY,
    );
    expect(r).toHaveLength(1);
    expect(r[0]?.date).toBe("2026-07-20");
  });

  it("跨 3 天 → 3 条, 首条预填 inflight, 后续空白", () => {
    const r = buildDetailDays(
      {
        actual_start_time: "2026-07-18T10:00:00Z",
        time_spent: 1.5,
        execute_info: "首日说明",
      },
      TODAY,
    );
    expect(r).toHaveLength(3);
    expect(r.map((d) => d.date)).toEqual([
      "2026-07-18",
      "2026-07-19",
      "2026-07-20",
    ]);
    // 首条预填
    expect(r[0]?.timeSpent).toBe("1.5");
    expect(r[0]?.execInfo).toBe("首日说明");
    // 后续空白 (待用户逐天填)
    expect(r[1]?.timeSpent).toBe("");
    expect(r[1]?.execInfo).toBe("");
    expect(r[2]?.timeSpent).toBe("");
    expect(r[2]?.execInfo).toBe("");
  });

  it("time_spent null → 首条 timeSpent 空 (execute_info 仍预填)", () => {
    const r = buildDetailDays(
      {
        actual_start_time: "2026-07-20T10:00:00Z",
        time_spent: null,
        execute_info: "有说明无耗时",
      },
      TODAY,
    );
    expect(r[0]?.timeSpent).toBe("");
    expect(r[0]?.execInfo).toBe("有说明无耗时");
  });

  it("远超 60 天 → 触发兜底截断 (≤61 条, 防死循环)", () => {
    // 兜底 `if (i > 60) break` 在 push 之后, 故最多 61 条 (i=0..60);
    // 与 task-detail-modal 行为一致。100 天的区间被显著截断 (远小于 100)。
    const start = TODAY.subtract(100, "day").toISOString();
    const r = buildDetailDays(
      { actual_start_time: start, time_spent: null, execute_info: null },
      TODAY,
    );
    expect(r).toHaveLength(61);
    expect(r.length).toBeLessThan(100);
  });

  it("start 在未来 (today+2) → [] (异常数据, 开始时间不应晚于今天)", () => {
    const start = TODAY.add(2, "day").toISOString();
    const r = buildDetailDays(
      { actual_start_time: start, time_spent: null, execute_info: null },
      TODAY,
    );
    expect(r).toEqual([]);
  });

  it("不传 today → 默认 dayjs().startOf('day'), 单条当天仍成立", () => {
    // 用「今天」作为 start, 不注入 today, 应返回至少 1 条
    const todayIso = dayjs().startOf("day").toISOString();
    const r = buildDetailDays({
      actual_start_time: todayIso,
      time_spent: null,
      execute_info: null,
    });
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r[0]?.date).toBe(dayjs().format("YYYY-MM-DD"));
  });
});

// ---------------------------------------------------------------------------
// ProblemDetailModal — 挂载行为 (problem_task_id 守护 + null 不渲染)
// ---------------------------------------------------------------------------

describe("ProblemDetailModal — 挂载行为", () => {
  beforeEach(() => {
    listTaskExecutesMock.mockReset();
  });

  it("problem=null → 不渲染 (container 为空)", () => {
    const { container } = render(
      <ProblemDetailModal problem={null} mode="detail" onClose={() => undefined} />,
    );
    expect(container.textContent).toBe("");
  });

  it("挂载 → 用 problem_task_id 拉执行记录 (D-002: 非 plan_task_id)", async () => {
    listTaskExecutesMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 100,
    });
    render(
      <ProblemDetailModal
        problem={mkProblem({ id: "p1", status: "进行中" })}
        mode="execute"
        onClose={() => undefined}
      />,
    );
    await waitFor(() => {
      expect(listTaskExecutesMock).toHaveBeenCalledWith({
        problem_task_id: "p1",
        page: 1,
        page_size: 100,
      });
    });
    // 守护: 不能误传 plan_task_id (plan/problem 共用表, 靠它互斥)
    const callArg = listTaskExecutesMock.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(callArg?.plan_task_id).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function mkProblem(over: Partial<ProblemList> & { id: string }): ProblemList {
  return {
    id: over.id,
    project_id: over.project_id ?? "proj-1",
    project_name: over.project_name ?? "项目甲",
    module_id: over.module_id ?? null,
    model_name: over.model_name ?? null,
    pro_desc: over.pro_desc ?? null,
    file_urls: over.file_urls ?? [],
    func_name: over.func_name ?? null,
    pro_type: over.pro_type ?? "bug",
    is_urgent: over.is_urgent ?? "0",
    find_by: over.find_by ?? null,
    find_time: over.find_time ?? null,
    pro_answer: over.pro_answer ?? null,
    work_type: over.work_type ?? null,
    created_by: over.created_by ?? null,
    duty_user_id: over.duty_user_id ?? null,
    duty_user_name: over.duty_user_name ?? null,
    plan_start_time: over.plan_start_time ?? null,
    plan_end_time: over.plan_end_time ?? null,
    real_end_time: over.real_end_time ?? null,
    audit_user_id: over.audit_user_id ?? null,
    audit_user_name: over.audit_user_name ?? null,
    audit_time: over.audit_time ?? null,
    remarks: over.remarks ?? null,
    is_delay_plan: over.is_delay_plan ?? null,
    work_load: over.work_load ?? null,
    status: over.status ?? "新建",
    effective_status: over.effective_status ?? null,
    time_spent: over.time_spent ?? null,
    now_node: over.now_node ?? null,
    now_handle_user: over.now_handle_user ?? null,
    now_handle_user_name: over.now_handle_user_name ?? null,
    handle_info: over.handle_info ?? null,
    check_info: over.check_info ?? null,
    check_result: over.check_result ?? null,
    check_time: over.check_time ?? null,
    created_at: over.created_at ?? "2026-07-01T00:00:00Z",
    updated_at: over.updated_at ?? "2026-07-01T00:00:00Z",
    spent_time: over.spent_time,
  };
}
