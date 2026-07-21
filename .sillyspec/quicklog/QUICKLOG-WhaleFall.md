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

## ql-20260721-006-c7a1 | 2026-07-21 11:10:00 | /ppm/plan-nodes 按页面样式规范调整(按钮antd化+Drawer→Modal+删除确认+颜色token)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx
结果：shadcn Button→antd(7处;操作列 ghost→link small/删除 danger、新建→primary、重新加载→default、明细保存→primary+loading、Drawer footer 保存→primary+loading)+1处原生 confirm→Modal.confirm+1个 Drawer→Modal(NodeFormDrawer footer 保留;onClose→onCancel)+硬编码色→token(emerald→success、amber→destructive、删除红随 danger;bg-red-50 错误语境保留)。eslint 0 error tsc 0 error。Table 保留(带 expandable)。

## ql-20260721-007-9d2e | 2026-07-21 11:30:00 | 修复 /ppm/milestone-details 新建/编辑里程碑 plan-node-ps POST/PUT 422
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
结果：根因=MasterDrawer submit 的 plan_workload 是 InputNumber(number),原 (vals.plan_workload as string) 直接发 number,后端 plan_workload:str 收 number 422(Pydantic v2 不 coerce number→str)。修复改 String() 转换(对齐明细表单 2122 写法)。日期字段 getValueProps/normalize+fromDate 返回 YYYY-MM-DD string,后端 datetime 正常解析,非 422 源。POST/PUT 都发 plan_workload 故都 422。tsc 0 error milestone-details 24测试通过。

## ql-20260721-008-a1b2 | 2026-07-21 15:10:00 | /ppm/problem-list 按页面样式规范调整(按钮antd化+Drawer→Modal+删除确认+颜色token)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/problem-list/page.tsx + _problem-drawer.tsx
结果：shadcn Button→antd(操作列 ghost→link small/删除 danger、工具栏 outline→default、新建/搜索→primary)+1处 confirm→Modal.confirm+3处 alert→message.error+_problem-drawer Drawer→Modal+硬编码色→token(rgba(0,0,0,0.45)→muted-foreground、#dc2626/#16a34a→destructive/success)。eslint 0 error tsc 0 error。problem-detail-modal 组件待随 task-plans 批次改。

## ql-20260721-009-b2c3 | 2026-07-21 16:20:00 | 批量按样式规范调整 problem-changes/task-plans/work-hours/work-hour-statistics + task-detail-modal/problem-detail-modal
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/{problem-changes,task-plans,work-hours,work-hour-statistics}/page.tsx + _components/{task-detail-modal,problem-detail-modal}.tsx
结果：4页面+2组件 shadcn Button→antd(操作列 ghost→link small/删除 danger、工具栏 outline→default、新建/搜索/完成/提交→primary、destructive→danger)+confirm→Modal.confirm+alert→message.error+Drawer/自写遮罩→antd Modal+硬编码色→token。子代理并行改+eslint/tsc 全 0 error。tsc 全量 0 error。至此 12 个 ppm 页面全部对齐 FRONTEND_PAGE_STYLE.md。
