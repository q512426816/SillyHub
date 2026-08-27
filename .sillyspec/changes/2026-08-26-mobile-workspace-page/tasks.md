---
author: qinyi
created_at: 2026-08-27 00:19:07
---
# 任务清单（Tasks）

> 骨架版（brainstorm 产出）——plan 阶段展开 Wave 分组/依赖/验收细节并写回本文件。
> 编号与 design.md §5/§6 对应；每任务落地时补 allowed_paths 与测试引用。

- [x] task-01: m/layout.tsx 加 DRILL_ROUTES 正则分支（钻取页裸容器：无底部 Tab）+ 正则纯函数与测试（FR-09/FR-11）(depends_on: —)
- [x] task-02: m/workspaces/[id]/layout.tsx 工作区上下文 Provider（getWorkspace 预取）+ page.tsx 主页 redirect → /changes（FR-02）(depends_on: —)
- [x] task-03: m/workspaces/page.tsx 解除门禁（:199 message.info → router.push）+ 新增导航断言测试（FR-01/FR-11）(depends_on: —)
- [x] task-04: MobileWorkspaceHeader 组件（返回+工作区名+段控双 Tab，真实路由切换）（FR-02）(depends_on: —)
- [x] task-05: MobileChangeCard 组件（阶段/待办徽标/相对时间）+ changes/page.tsx 导出 PENDING_REVIEW_LABEL（FR-03；Grill C-10）(depends_on: —)
- [x] task-06: 变更列表移动页（三Tab+计数+搜索+MobileFilterDrawer 筛选+智能轮询复用）（FR-03）(depends_on: task-02,04,05)
- [x] task-07: quicklog Tab + MobileDetailSheet 详情（listQuicklogEntries/quicklogPollInterval 复用）（FR-05）(depends_on: task-06)
- [x] task-08: MobileChangeDetail 组件（阶段步骤条/审批卡 submitStageReview/文档卡 FilePreviewModal/时间线/日志折叠/会话入口/任务桌面引导条）（FR-04）(depends_on: task-05)
- [x] task-09: 变更详情移动页 changes/[cid]/page.tsx（钻取、返回顶栏）（FR-04/FR-09）(depends_on: task-01,02,08)
- [x] task-10: 深链兜底 redirect 薄壳 ×2（changes/[cid]/sessions、quicklog/[qlId]/sessions → 会话列表）（FR-10；Grill C-11）(depends_on: —)
- [x] task-11: MobileSessionList 组件（listAgentSessions+workspace_id 同 key query、机器分组、状态 Tab、卡片菜单 删除/归档/取消归档）（FR-06；Grill C-08）(depends_on: task-01)
- [x] task-12: 会话列表移动页 sessions/page.tsx（含预会话态承载与切真会话路由）（FR-06/FR-08）(depends_on: task-02,04,11,13)
- [x] task-13: PreSessionPicker 加 variant（bottomSheet 底部抽屉两步，默认 center 零回归）（FR-08/FR-11）(depends_on: —)
- [x] task-14: SessionPanel variant 适配（通读渲染层耦合清单 → mobile 布局类/次要 chrome 收纳，逻辑零分叉）+「不传 variant 与 desktop 一致」回归测试（FR-07/FR-11；R-01）(depends_on: —)
- [x] task-15: 会话对话移动页 sessions/[sid]/page.tsx（SessionPanel 第四宿主，machines/llmProviders 页面级数据同源）（FR-07/FR-09）(depends_on: task-01,02,14)
- [x] task-16: 全量自测清单（双主题切换/键盘避让/深链矩阵/桌面既有测试全绿）+ 文档核对（X-03 组件复用落位清单、X-04 key 锁形态用例）(depends_on: task-01,02,03,04,05,06,07,08,09,10,11,12,13,14,15)
- [ ] ql-20260827-010-5fa3 工作区移动端页面（变更中心 + 会话移植）
- [x] ql-20260827-011-e756 工作区移动端页面（变更中心 + 会话移植）
- [ ] ql-20260827-012-6c87 工作区移动端页面（变更中心 + 会话移植）
