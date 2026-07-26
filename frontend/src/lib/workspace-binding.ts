import { apiFetch } from "./api";
import type { components } from "@/lib/api-types";

/**
 * Per-member workspace daemon binding (task-03/10, change 2026-07-01-collaborative-workspace).
 */

// MemberBindingUpsertRequest 从 OpenAPI 自动生成（@/lib/api-types），
// 后端 schema 来源：backend/app/modules/workspace/member_runtimes/router.py。
export type MemberBindingUpsertRequest = components["schemas"]["MemberBindingUpsertRequest"];

// MemberBindingView 从 OpenAPI 自动生成（@/lib/api-types）。
// 后端 member_runtimes/router.py 三端点已声明 response_model=MemberBindingView。
export type MemberBindingView = components["schemas"]["MemberBindingView"];

/**
 * Fetch current user's own binding for this workspace.
 * Returns null when no binding exists (frontend shows access guide).
 */
export async function fetchMyBinding(
  workspaceId: string,
): Promise<MemberBindingView | null> {
  try {
    const data = await apiFetch<MemberBindingView | null>(
      `/api/workspaces/${workspaceId}/my-binding`,
    );
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * 遗留 1（daemon-entity-binding）：批量拉取当前用户在所有 workspace 的 binding。
 * 返回 list（前端自行按 workspace_id 索引成 Map）。失败降级为空数组（列表卡片不阻塞）。
 */
export async function fetchMyBindings(): Promise<MemberBindingView[]> {
  try {
    const data = await apiFetch<MemberBindingView[] | null>(
      "/api/workspaces/my-bindings",
    );
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * Upsert current user's binding for this workspace.
 */
export async function upsertMyBinding(
  workspaceId: string,
  req: MemberBindingUpsertRequest,
): Promise<MemberBindingView> {
  return apiFetch<MemberBindingView>(
    `/api/workspaces/${workspaceId}/my-binding`,
    { method: "PUT", json: req },
  );
}

/* ------------------------------------------------------------------ */
/*  daemon 共享（change 2026-07-25-daemon-borrow-for-business task-12） */
/*                                                                    */
/*  后端 task-04 已就绪（router.py）：                                 */
/*   - PUT   /workspaces/{ws}/my-binding/shared   lender 标记/撤销自己  */
/*   - GET   /workspaces/{ws}/shared-daemons      owner 查所有共享 daemon */
/*   - DELETE /workspaces/{ws}/members/{uid}/shared owner 撤销某成员共享 */
/*                                                                    */
/*  注：OpenAPI 生成类型（api-types.ts）尚未刷新含 `shared` 字段与      */
/*  SharedDaemonView。这里在本地补类型（intersection + 本地 view），    */
/*  待后端 dump openapi + pnpm gen:types 后可切回生成类型。            */
/* ------------------------------------------------------------------ */

/**
 * 后端 MemberBindingView 已加 `shared` 列（model 默认 false，零回归）。
 * 生成类型暂缺该字段，这里 intersection 补齐，消费方按字段访问不报 TS 错。
 */
export type MemberBindingWithShared = MemberBindingView & { shared: boolean };

/** owner 视角下一条共享 daemon（对齐后端 SharedDaemonView）。 */
export interface SharedDaemonView {
  /** 出借人（开发人员）user_id。 */
  lender_user_id: string;
  daemon_id: string | null;
  /** daemon 在线状态（JOIN daemon_instances），online/离线/null。 */
  daemon_status: string | null;
  daemon_hostname: string | null;
  /** owner 调用恒 true（前端用于决定是否渲染撤销按钮）。 */
  revocable: boolean;
}

/**
 * lender 标记/撤销自己 binding 的 daemon 共享（FR-01 / D-003@v1）。
 * 后端钉死当前用户 → 仅能改自己 binding；未配置 binding 抛 409 直通 ApiError。
 */
export async function setMyBindingShared(
  workspaceId: string,
  shared: boolean,
): Promise<MemberBindingWithShared> {
  return apiFetch<MemberBindingWithShared>(
    `/api/workspaces/${workspaceId}/my-binding/shared`,
    { method: "PUT", json: { shared } },
  );
}

/**
 * owner 查工作空间所有共享 daemon（FR-02 / D-003@v1）。
 * 非 owner/无 WORKSPACE_MEMBER_MANAGE 权限会 403 → 这里降级为空数组，
 * 让 owner 管理卡片在不具备权限时静默不阻塞（与 fetchMyBinding 降级语义一致）。
 */
export async function fetchSharedDaemons(
  workspaceId: string,
): Promise<SharedDaemonView[]> {
  try {
    const data = await apiFetch<SharedDaemonView[] | null>(
      `/api/workspaces/${workspaceId}/shared-daemons`,
    );
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * owner 撤销某成员的 daemon 共享（FR-02 / D-003@v1）。
 * 后端设 shared=False 不删 binding 行；target 无 binding 抛 409 直通 ApiError。
 */
export async function revokeSharedDaemon(
  workspaceId: string,
  lenderUserId: string,
): Promise<MemberBindingWithShared> {
  return apiFetch<MemberBindingWithShared>(
    `/api/workspaces/${workspaceId}/members/${encodeURIComponent(lenderUserId)}/shared`,
    { method: "DELETE" },
  );
}

/* ------------------------------------------------------------------ */
/*  FR-04 门禁放宽（task-13 / D-002@v1）                                */
/*                                                                    */
/*  业务/管理人员（business_member）无自有 daemon，但持 ``daemon:borrow``  */
/*  能力时可借用工作空间共享 daemon 触发 agent（后端 placement 自动借用，  */
/*  design §5 Phase 2/3）。前端「启动扫描」按钮按本函数放宽 ``!daemon_id`` */
/*  禁用——后端 _resolve_borrowed_or_own_runtime 做权威三重校验，前端只    */
/*  按 ``/api/auth/me`` 返回的权限并集（platform ∪ all-workspace）判断。  */
/* ------------------------------------------------------------------ */

/** Permission.DAEMON_BORROW.value（与 backend auth/permissions.py 对齐）。 */
export const DAEMON_BORROW_PERMISSION = "daemon:borrow";

/**
 * 当前用户是否有能力借用工作空间共享 daemon（FR-04 门禁放宽判断，纯函数）。
 *
 * 判定：``is_platform_admin`` 短路（平台管理员继承全部能力）OR 权限并集含
 * ``daemon:borrow``（business_member 角色授此权限，task-03 / D-006@v2）。
 * 前端仅放行让用户能点按钮，后端 placement 再做 workspace-scoped 权威校验
 * （含 workspace 是否真有 shared online daemon），避免前端误判后端 403/422。
 */
export function canBorrowSharedDaemon(
  permissions: string[] | undefined | null,
  isPlatformAdmin: boolean | undefined,
): boolean {
  if (isPlatformAdmin) return true;
  return Array.isArray(permissions) && permissions.includes(DAEMON_BORROW_PERMISSION);
}
