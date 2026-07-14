"use client";

/**
 * ProfileSummaryCard — 个人信息卡 (task-09 / FR-02 / D-002@v1 / D-003@v1 / D-004@v1)。
 *
 * 左栏顶部卡片:头像首字 + 姓名/工号/部门/角色,复用 SectionCard(标题="个人信息")
 * 与 ui/avatar(Avatar/AvatarFallback)。布局参照原型左栏 `.profile`:
 *   `.avatar` 圆角方块 + linear-gradient(135deg, blue, cyan) 渐变背景(原型行 13)。
 *
 * 空值兜底(D-002/003/004):display_name/employee_no/department_name/role_name
 * 任一为 null/undefined/"" 时统一显示「—」;avatar_text 必填,但 profile=null
 * (接口未就绪/loading)时兜底「?」,保证组件始终可渲染不报错。
 *
 * 组件为纯展示,数据由 task-08 page.tsx 装配后下传 props(不调用接口)。
 */
import { SectionCard } from "@/components/layout";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
  return (
    <SectionCard title="个人信息" bodyPadding="p-4">
      <div className="flex items-center gap-3">
        {/* 头像首字:渐变背景对齐原型 .avatar(linear-gradient blue→cyan) */}
        <Avatar className="size-14 shrink-0 rounded-xl">
          <AvatarFallback className="rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 text-lg font-bold text-white">
            {profile?.avatar_text && profile.avatar_text.trim() !== ""
              ? profile.avatar_text
              : "?"}
          </AvatarFallback>
        </Avatar>

        {/* 右侧纵向文本块:姓名 + 工号/部门/角色 */}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-base font-medium text-foreground">
            {placeholder(profile?.display_name)}
          </span>
          <span className="text-xs text-muted-foreground">
            工号:{placeholder(profile?.employee_no)}
          </span>
          <span className="text-xs text-muted-foreground">
            部门:{placeholder(profile?.department_name)}
          </span>
          <span className="text-xs text-muted-foreground">
            角色:{placeholder(profile?.role_name)}
          </span>
        </div>
      </div>
    </SectionCard>
  );
}
