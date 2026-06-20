"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  WorkspaceMemberRoleKey,
  WorkspaceMemberView,
} from "@/lib/workspace-members";

// FR-07 第 1 GWT：role dropdown 选项只含白名单 3 个
// 与 task-07 ROLE_OPTIONS 同步；不暴露 platform_admin / reviewer / qa / component_lead
const ROLE_OPTIONS: ReadonlyArray<{
  value: WorkspaceMemberRoleKey;
  label: string;
}> = [
  { value: "developer", label: "开发者" },
  { value: "viewer", label: "只读成员" },
  { value: "workspace_owner", label: "工作区所有者" },
];

interface Props {
  member: WorkspaceMemberView;
  // 父组件全局操作锁：任一写入操作进行中时所有行禁用
  actionLoading: boolean;
  onRoleChange: (_role: WorkspaceMemberRoleKey) => void;
  onSetOwner: () => void;
  onRemove: () => void;
}

/**
 * Members 表格单行：4 列 User / Role / Granted At / Actions。
 *
 * 权限禁用规则（design R-04 防自我降级）：
 * - 当前用户行（is_current_user=true）：role dropdown / Set Owner / Remove 全部 disabled
 *   - 改自己 role → 失去管理权风险
 *   - transfer 给自己 → backend 400（前端先禁用避免无意义请求）
 *   - remove 自己 → backend 400（前端先禁用）
 * - 非 owner 行的 dropdown / Set Owner / Remove 全部可点；后端兜底权限
 * - "最后 owner 不可移除" 由 backend cannot_remove_last_owner 兜底，前端不预判
 */
export function WorkspaceMemberRow({
  member,
  actionLoading,
  onRoleChange,
  onSetOwner,
  onRemove,
}: Props) {
  const isCurrentUser = member.is_current_user;
  const isOwner = member.role_key === "workspace_owner";

  const roleDisabled = actionLoading || isCurrentUser;
  const setOwnerDisabled = actionLoading || isCurrentUser;
  const removeDisabled = actionLoading || isCurrentUser;

  const displayName = member.display_name?.trim() || member.email;

  return (
    <tr className="border-t border-border">
      {/* Col 1: User */}
      <td className="px-3 py-2 align-top">
        <div className="flex flex-col">
          <span className="text-xs font-medium">
            {displayName}
            {isCurrentUser && (
              <span className="ml-1 text-[11px] text-muted-foreground">
                （你）
              </span>
            )}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {member.email}
          </span>
        </div>
      </td>

      {/* Col 2: Role dropdown */}
      <td className="px-3 py-2 align-top">
        <div className="flex items-center gap-1.5">
          <select
            value={member.role_key}
            onChange={(e) =>
              onRoleChange(e.target.value as WorkspaceMemberRoleKey)
            }
            disabled={roleDisabled}
            className="h-7 rounded border border-input bg-background px-2 text-xs focus:border-ring focus:outline-none disabled:opacity-50"
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
            {/* 防御性 fallback：若 backend 回显非白名单 role_key（如 platform_admin），显示 disabled option 避免受控组件警告 */}
            {!ROLE_OPTIONS.some((o) => o.value === member.role_key) && (
              <option value={member.role_key} disabled>
                {member.role_name} ({member.role_key}) — 不可修改
              </option>
            )}
          </select>
          {isOwner && (
            <Badge variant="default" className="text-[10px]">
              所有者
            </Badge>
          )}
        </div>
      </td>

      {/* Col 3: Granted At */}
      <td className="px-3 py-2 align-top text-[11px] text-muted-foreground">
        {new Date(member.granted_at).toLocaleString("zh-CN")}
      </td>

      {/* Col 4: Actions */}
      <td className="px-3 py-2 text-right align-top">
        <div className="inline-flex gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={onSetOwner}
            disabled={setOwnerDisabled}
          >
            设为所有者
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onRemove}
            disabled={removeDisabled}
            className="text-destructive hover:text-destructive"
          >
            移除
          </Button>
        </div>
      </td>
    </tr>
  );
}
