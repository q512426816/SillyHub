---
author: WhaleFall
created_at: 2026-07-21T08:48:56
---

<!-- 本文件从空开始。ql-ID 续号规则：扫描同目录所有 QUICKLOG*.md 文件，
     取当天(YYYYMMDD)最大序号 +1。归档历史见 QUICKLOG-WhaleFall-<DATE>.md。 -->

## ql-20260721-002-b4c2 | 2026-07-21 09:11:58 | /ppm/milestone-details 按页面样式规范调整(第一批:按钮antd化+删除确认+颜色token)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
结果：第一批——shadcn Button 全量换 antd(28处;操作列 ghost→link small、删除加 danger、工具栏 outline→default、新建→primary、Drawer/footer 保存→primary+loading 去掉"提交中…"文案)+3处原生 confirm→Modal.confirm(静态,与 message 一致)+硬编码色→token(emerald→success、blue→primary、amber/red→destructive、slate→border/muted-foreground;bg-red-50 错误语境保留合规)。eslint 0 error(19既有warning) tsc 0 error。3个 Drawer→Modal 留第二批。

## ql-20260721-003-c8d1 | 2026-07-21 10:05:00 | /ppm/milestone-details 按页面样式规范调整(第二批:3个 Drawer→Modal)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
结果：第二批——3个 Drawer→Modal(模块 extra 按钮→footer、明细 extra 状态Tag→title 内联 footer 保留、里程碑 footer 保留);统一 onClose→onCancel、补 maskClosable={false}、删 Drawer import、</Drawer>→</Modal>。eslint 0 error(19既有warning) tsc 0 error milestone-details 24测试通过。

## ql-20260721-004-a3f2 | 2026-07-21 10:12:00 | /ppm/milestone-details 主表操作列(+新建明细/编辑里程碑/删除里程碑)加宽
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
结果：主表(里程碑)操作列 width 280→340(+新建明细/编辑里程碑/删除里程碑 3 按钮加宽,避免挤换行)。纯列宽数字改动。

## ql-20260721-005-5d8e | 2026-07-21 10:25:00 | /ppm/milestone-details 明细子表加计划开始/结束时间列
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
结果：明细子表(DetailLevelTable)在「计划工时」列后新增「计划开始」「计划结束」两列(width 120,fmtDate 回显 plan_begin_time/plan_complete_time)。tsc 0 error milestone-details 24测试通过。
