/**
 * PPM workbench(个人工作台)只读聚合 API client。
 *
 * 端点前缀 `/api/ppm/workbench/*`(design §7.1~§7.3 + 切换用户/分页扩展):
 * - GET /profile?target_user_id=   当前/目标用户基本信息(姓名/工号/部门/角色/头像首字/can_view_others)
 * - GET /summary?range=&target_user_id=   指标汇总(任务数/完成率/延期率/工时/缺陷);待办已移至 /todos
 * - GET /calendar?year_month=&target_user_id=   当月每日任务负载/预警分档
 * - GET /todos?target_user_id=&page=&page_size=   待办分页(默认每页 10 条,D-001)
 * - GET /switchable-users   当前登录人可切换查看的用户列表(D-002)
 *
 * 走统一 `apiFetch`(自动带 token + 401 刷新),对齐 lib/ppm/task.ts 风格;
 * 字段 snake_case 与后端 Pydantic 直出一致,不做 camelCase 转换。
 * query 参数用对象字面量(apiFetch 内部已处理 undefined/null/空串过滤)。
 *
 * targetUserId 可选:undefined/null/空串=当前登录人(兼容旧行为);否则透传 target_user_id。
 *
 * 依据:design §7 + tasks/task-07.md。
 */
import { apiFetch } from "@/lib/api";
import type {
  PageResp,
  WorkbenchCalendar,
  WorkbenchProfile,
  WorkbenchSummary,
  WorkbenchSwitchableUser,
  WorkbenchTodoItem,
} from "./types";

/** 透传 target_user_id query(undefined/null/空串 → 不带,即当前登录人)。 */
function targetQuery(targetUserId?: string | null): { target_user_id?: string } {
  return targetUserId ? { target_user_id: targetUserId } : {};
}

/**
 * (目标)用户基本信息(design §7.1)。
 */
export async function fetchWorkbenchProfile(
  targetUserId?: string | null,
): Promise<WorkbenchProfile> {
  return apiFetch<WorkbenchProfile>("/api/ppm/workbench/profile", {
    query: targetQuery(targetUserId),
  });
}

/**
 * (目标)用户工作台指标汇总(design §7.2;待办已移至 /todos,D-003)。
 *
 * @param range 统计口径区间:"week" 本周 / "month" 当月(默认) / "all" 全部。
 * @param targetUserId 切换查看的目标用户;空=当前登录人。
 */
export async function fetchWorkbenchSummary(
  range: "week" | "month" | "all" = "month",
  targetUserId?: string | null,
): Promise<WorkbenchSummary> {
  return apiFetch<WorkbenchSummary>("/api/ppm/workbench/summary", {
    query: { range, ...targetQuery(targetUserId) },
  });
}

/**
 * (目标)用户当月日历(design §7.3)。
 *
 * @param yearMonth "YYYY-MM"。
 * @param targetUserId 切换查看的目标用户;空=当前登录人。
 */
export async function fetchWorkbenchCalendar(
  yearMonth: string,
  targetUserId?: string | null,
): Promise<WorkbenchCalendar> {
  return apiFetch<WorkbenchCalendar>("/api/ppm/workbench/calendar", {
    query: { year_month: yearMonth, ...targetQuery(targetUserId) },
  });
}

/**
 * (目标)用户待办分页(FR-1 / D-001@v1)。
 *
 * @param targetUserId 切换查看的目标用户;空=当前登录人。
 * @param page 页码,从 1 起(默认 1)。
 * @param pageSize 每页条数(默认 10)。
 */
export async function fetchWorkbenchTodos(
  targetUserId: string | null | undefined,
  page = 1,
  pageSize = 10,
): Promise<PageResp<WorkbenchTodoItem>> {
  return apiFetch<PageResp<WorkbenchTodoItem>>("/api/ppm/workbench/todos", {
    query: { ...targetQuery(targetUserId ?? undefined), page, page_size: pageSize },
  });
}

/**
 * 当前登录人可切换查看的用户列表(FR-2 / D-002)。
 *
 * 非经理/非超管后端返回空数组(前端据此不渲染切换入口)。
 */
export async function fetchWorkbenchSwitchableUsers(): Promise<
  WorkbenchSwitchableUser[]
> {
  return apiFetch<WorkbenchSwitchableUser[]>(
    "/api/ppm/workbench/switchable-users",
  );
}
