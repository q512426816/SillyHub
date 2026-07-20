"use client";

/**
 * ProfileSummaryCard — 个人信息卡 (task-09 / FR-02 / D-002@v1 / D-003@v1 / D-004@v1)。
 *
 * 左栏顶部卡片:渐变头像 + 姓名/角色徽标/工号/部门,复用 SectionCard(标题="个人信息")
 * 与 ui/avatar(Avatar/AvatarFallback)。头像渐变参照原型左栏 `.profile`:
 *   `.avatar` 圆角方块 + linear-gradient(135deg, blue, cyan) 渐变背景(原型行 13)。
 *
 * 空值兜底(D-002/003/004):display_name/employee_no/department_name 任一为
 * null/undefined/"" 时统一显示「—」;role_name 为空则不渲染角色徽标;avatar_text
 * 必填,但 profile=null(接口未就绪/loading)时兜底「?」,保证组件始终可渲染不报错。
 *
 * 组件为纯展示,数据由 task-08 page.tsx 装配后下传 props(不调用接口)。
 */
import { SectionCard } from "@/components/layout";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { WorkbenchProfile } from "@/lib/ppm/types";

export interface ProfileSummaryCardProps {
  /** 当前登录人信息;null 时渲染占位(不报错)。 */
  profile: WorkbenchProfile | null;
}

/** 空字符串/undefined/null 统一兜底「—」。 */
function placeholder(value: string | null | undefined): string {
  return value && value.trim() !== "" ? value : "—";
}

export function ProfileSummaryCard({ profile }: ProfileSummaryCardProps) {
  const role = profile?.role_name?.trim();
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
    </SectionCard>
  );
}
