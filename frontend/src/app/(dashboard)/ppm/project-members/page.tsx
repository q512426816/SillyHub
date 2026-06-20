"use client";

/**
 * 项目成员页面 /ppm/project-members
 *
 * 平铺全量成员管理:角色 auth.Role 多选(D-009)+ 选用户联动回填部门/手机/姓名。
 * 实现下沉到 PpmProjectMembersTable 组件(与 projects 页面「成员管理」抽屉复用)。
 *
 * 依据:.sillyspec/changes/2026-06-21-ppm-frontend-alignment/tasks/task-03.md
 * 参照源:vue views/ppm/projectmember/{index,ProjectMemberForm}.vue
 */
import { PpmProjectMembersTable } from "@/components/ppm-project-members-table";

export default function PpmProjectMembersPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6">
      <header>
        <h1 className="mt-0.5">项目成员</h1>
        <p className="text-xs text-muted-foreground">
          项目成员主数据,被审批流 / 看板依赖
        </p>
      </header>
      <PpmProjectMembersTable />
    </div>
  );
}
