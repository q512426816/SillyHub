import { apiFetch } from "./api";

// task-11：transition/review 封装（transitionChange/submitReview/listReviews/ReviewEntry）
// 已合并进 lib/changes.ts（单一来源 D-006）。本文件仅保留 task 状态流转 transitionTask，
// 不属于 change transition 契约。

/**
 * Task 状态流转 — POST /api/workspaces/{wid}/tasks/{tid}/transition
 *
 * 注意：这是 task（TaskCard）级别的状态流转，与 change 的阶段流转（transitionChange，
 * 已迁至 @/lib/changes）是不同契约，不可混用。
 */
export function transitionTask(
  workspaceId: string,
  taskId: string,
  targetStatus: string,
) {
  return apiFetch<{ id: string; status: string }>(
    `/api/workspaces/${workspaceId}/tasks/${taskId}/transition`,
    { method: "POST", json: { target: targetStatus } },
  );
}
