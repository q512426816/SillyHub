"use client";

/**
 * 项目成员页面 /ppm/project-members — 对齐 project-plans 风格。
 *
 * 平铺全量成员管理:角色 auth.Role 多选(D-009)+ 选用户联动回填部门/手机/姓名。
 * 实现下沉到 PpmProjectMembersTable 组件(与 projects 页面「成员管理」抽屉复用)。
 */
import { PageContainer, PageHeader } from "@/components/layout";
import { PpmProjectMembersTable } from "@/components/ppm-project-members-table";

export default function PpmProjectMembersPage() {
  return (
    <PageContainer size="full">
      <PageHeader
        title="项目成员"
        subtitle="项目成员主数据,被审批流 / 看板依赖"
      />
      <PpmProjectMembersTable />
    </PageContainer>
  );
}
