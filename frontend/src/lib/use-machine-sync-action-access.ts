"use client";

/**
 * useMachineSyncActionAccess — 平台同步处理区（PlatformSyncSection）操作权限
 * hook（2026-09-04-conflict-resolve-entry task-09 / FR-04 / D-003@v1）。
 *
 * 判定（design §5 Phase 3）：平台管理员（session.is_platform_admin）或机器
 * 所有者本人（machine.owner.user_id === 当前用户 id）→ canOperate=true，其余
 * 成员只读（仅冲突清单与计数，不渲染裁决/清理按钮）。
 *
 * 仿 delete-change-confirm 的 useChangeDeleteAccess 先例：仅从 session store
 * 取 userId / is_platform_admin 做入口可见性启发式（少给无权用户看按钮），
 * **不是权限判定**——后端 POST /machines/{id}/sillyspec-resolve 的
 * RuntimeAdminUser + _get_owned_instance 组合权限为权威，前端判漏时后端
 * 404（普通用户非本机防存在性泄漏）/ 403 兜底，走 notify.error 中文 toast。
 * 与 useChangeDeleteAccess 的差异：比较对象是机器归属而非变更归属，无需
 * fetchMe 的 workspace role（机器所有者字段在机器视图内自带），零额外请求。
 */
import { useSession } from "@/stores/session";
import type { DaemonMachineRead } from "@/lib/daemon";

export interface MachineSyncActionAccess {
  /** 当前登录用户是否平台管理员（session store）。 */
  isPlatformAdmin: boolean;
  /** 可执行裁决/清理操作（平台管理员或机器所有者本人；未登录恒 false）。 */
  canOperate: boolean;
}

/**
 * @param machine 数据源机器（my-binding.daemon_id 在机器视图中的匹配行）；
 * 无绑定/加载中传 null——此时仅管理员判定仍成立（管理员可在无机器数据时
 * 预判可见性，但卡片本身不渲染，canOperate 不会被消费）。
 */
export function useMachineSyncActionAccess(
  machine: Pick<DaemonMachineRead, "owner"> | null | undefined,
): MachineSyncActionAccess {
  const user = useSession((s) => s.user);
  const isPlatformAdmin = Boolean(user?.is_platform_admin);
  const ownerId = machine?.owner?.user_id ?? null;
  const canOperate =
    isPlatformAdmin || (ownerId !== null && ownerId === user?.id);
  return { isPlatformAdmin, canOperate };
}
