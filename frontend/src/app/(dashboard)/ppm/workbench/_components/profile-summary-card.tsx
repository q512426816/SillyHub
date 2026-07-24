"use client";

/**
 * ProfileSummaryCard — 个人信息卡 (task-09 / FR-02 / D-005@v1)。
 *
 * 左栏顶部卡片:渐变头像 + 姓名/角色徽标/工号/部门。登录人 can_view_others
 * (经理 ‖ super_admin)时,额外渲染「切换用户」下拉,选项=switchable-users +
 * 「我自己」,选中回调 onSwitchUser(userId|null),由 page 维护 targetUserId。
 *
 * 切换用户后 profile 数据为目标人,但 can_view_others/switchableUsers 始终反映
 * 登录人能力(后端 profile.can_view_others 反映 actor,见 D-005)。
 */
import { SectionCard } from "@/components/layout";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { WorkbenchProfile, WorkbenchSwitchableUser } from "@/lib/ppm/types";

export interface ProfileSummaryCardProps {
  /** 当前展示(目标)用户信息;null 时渲染占位(不报错)。 */
  profile: WorkbenchProfile | null;
  /** 登录人是否可切换查看他人(经理 ‖ super_admin);控制切换下拉显隐。 */
  canViewOthers?: boolean;
  /** 可切换的用户列表(登录人可见集)。 */
  switchableUsers?: WorkbenchSwitchableUser[];
  /** 当前选中的目标用户 id;null=我自己。 */
  targetUserId?: string | null;
  /** 切换用户回调;null 表示切回我自己。 */
  onSwitchUser?: (userId: string | null) => void;
}

/** 空字符串/undefined/null 统一兜底「—」。 */
function placeholder(value: string | null | undefined): string {
  return value && value.trim() !== "" ? value : "—";
}

export function ProfileSummaryCard({
  profile,
  canViewOthers,
  switchableUsers,
  targetUserId,
  onSwitchUser,
}: ProfileSummaryCardProps) {
  const role = profile?.role_name?.trim();
  const showSwitch = canViewOthers && (switchableUsers?.length ?? 0) > 0;
  const selectValue = targetUserId ?? "__me__";

  return (
    <SectionCard title="个人信息" bodyPadding="p-5">
      <div className="flex items-center gap-4">
        {/* 头像首字:渐变背景 + 柔和投影,对齐原型 .avatar 视觉 */}
        <Avatar className="size-16 shrink-0 rounded-2xl shadow-md shadow-blue-600/20">
          <AvatarFallback className="rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-500 text-xl font-bold text-white">
            {profile?.avatar_text && profile.avatar_text.trim() !== ""
              ? profile.avatar_text
              : "?"}
          </AvatarFallback>
        </Avatar>

        {/* 右侧纵向文本块:姓名+角色徽标 / 工号 / 部门 */}
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-lg font-semibold text-foreground">
              {placeholder(profile?.display_name)}
            </span>
            {role ? (
              <Badge variant="info" className="shrink-0">
                {role}
              </Badge>
            ) : null}
          </div>
          <span className="text-xs text-muted-foreground">
            工号：{placeholder(profile?.employee_no)}
          </span>
          <span className="text-xs text-muted-foreground">
            部门：{placeholder(profile?.department_name)}
          </span>
        </div>
      </div>

      {/* 切换用户(仅经理 ‖ super_admin 且有可切换用户时渲染) */}
      {showSwitch ? (
        <div className="mt-3 border-t border-border pt-3">
          <label className="mb-1 block text-xs text-muted-foreground">
            切换查看其他成员工作台
          </label>
          <select
            value={selectValue}
            onChange={(e) =>
              onSwitchUser?.(e.target.value === "__me__" ? null : e.target.value)
            }
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="__me__">我自己</option>
            {switchableUsers?.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {placeholder(u.display_name)}
                {u.department_name ? `（${u.department_name}）` : ""}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </SectionCard>
  );
}
