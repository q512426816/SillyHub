"use client";

/**
 * 项目成员页面 /ppm/project-members — 两级展开表(项目→成员)。
 *
 * 一级项目表 + 展开行懒加载成员子表(复用 PpmProjectMembersTable embedded 模式)+
 * 全局跨项目新增(复用 MemberFormDrawer)。实现下沉到 PpmProjectMembersGroupTable 组件。
 * 依据:design.md §7.5;task-09 仅切换渲染组件,外壳(PageContainer/PageHeader)保留。
 */
import { PageContainer, PageHeader } from "@/components/layout";
import { PpmProjectMembersGroupTable } from "@/components/ppm-project-members-group-table";

export default function PpmProjectMembersPage() {
  return (
    <PageContainer size="full">
      <PageHeader
        title="项目成员"
        subtitle="项目成员主数据,被审批流 / 看板依赖"
      />
      <PpmProjectMembersGroupTable />
    </PageContainer>
  );
}
