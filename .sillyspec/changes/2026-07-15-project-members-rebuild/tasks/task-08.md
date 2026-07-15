---
id: task-08
title: "新增 ppm-project-members-group-table.tsx — 搜索区 + 一级项目 expandable 表 + 展开行复用成员表 + 全局新增"
title_zh: 项目→成员两级展开表组件
author: WhaleFall
created_at: 2026-07-15 11:05:37
priority: P0
depends_on: [task-06, task-07]
blocks: [task-09]
requirement_ids: [FR-01, FR-02, FR-03, FR-05, FR-06, FR-08]
decision_ids: [D-002@v1, D-003@v1, D-006@v1, D-007@v1]
allowed_paths:
  - frontend/src/components/ppm-project-members-group-table.tsx
goal: 实现项目→成员两级展开表（搜索区 + 项目级 antd Table expandable + 展开行复用成员表 + 全局跨项目新增），消费聚合接口。
implementation:
  - "use client" 新建组件；state 含 summary 分页结果/搜索表单/展开 keys/全局新增抽屉；load 调 pageProjectMemberSummary(params) 真分页
  - 一级 antd Table columns：项目名/编号/负责人(owner_name None→「—」)/成员数/状态(StatusBadge)/类型(Tag)/更新时间/操作
  - expandable.expandedRowRender 内嵌 <PpmProjectMembersTable projectId={record.id} embedded onChanged={load} />
  - 页头「+ 添加项目成员」用 MemberFormDrawer mode=create lockedProjectId=undefined（显示项目选择），onSubmit 调 createProjectMember + load
  - 搜索区 6 字段复用 projects 页 PROJECT_TYPE_OPTIONS / PROJECT_STATUS_OPTIONS 枚举（不复制 magic value）
acceptance:
  - 进页面看项目级列表（非成员平铺）
  - 点项目行展开懒加载成员子表
  - 6 维搜索各自生效
  - 全局新增跨项目 + 项目内新增锁定 都正常
  - 增删成员后 member_count 实时刷新（onChanged=load）
  - 负责人 None→「—」
  - tsc + lint 过
verify:
  - cd frontend && pnpm exec tsc --noEmit && pnpm lint
constraints:
  - 展开行用 embedded 模式（G1）
  - 真分页调 summary，不前端 groupBy / 不 N+1
  - 复用 PpmProjectMembersTable / MemberFormDrawer，不重写成员 CRUD
  - 枚举复用 projects 页
provides:
  - contract: PpmProjectMembersGroupTable
    fields: [component]
expects_from:
  task-06:
    - contract: pageProjectMemberSummary
      needs: [params, returns]
  task-07:
    - contract: MemberFormDrawer
      needs: [mode, row, lockedProjectId, canWrite, onClose, onSubmit]
    - contract: PpmProjectMembersTable
      needs: [projectId, onChanged, embedded]
---

# task-08 — 项目→成员两级展开表组件

依据 design.md §7.5、原型 prototype-project-members-rebuild.html。核心 UI 任务。
