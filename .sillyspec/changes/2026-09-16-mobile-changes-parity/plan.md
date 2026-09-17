---
author: qinyi
created_at: 2026-09-16 21:22:30
plan_level: light
---

# 轻量计划（Light Plan）：变更中心移动端与 PC 端功能对齐

## 来源

用户需求（2026-09-16）：「手机端，变更中心内容要跟 pc 端页面功能保持一致」。brainstorm 结论：列表页 5 项 + 详情页 5 项补齐（design.md 总体方案 Wave 1/2/3，D-001@v1 ~ D-005@v1，FR-01~FR-07）。

## 复杂度分类

```
plan_level: light
reason: 前端单模块（frontend）功能补齐，8 文件 8 任务（未超 8）、无 schema/DB/状态机/CLI 变更、无并行子代理需求、设计已经独立 Grill 审查无歧义
estimated_files: 8
cross_module: false
has_schema_change: false
has_state_machine_change: false
needs_parallel_execution: false
needs_human_review: false
```

## 范围

- frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx（export 三个格式化 helper）
- frontend/src/components/mobile/mobile-change-card.tsx（信息增强）
- frontend/src/app/m/workspaces/[id]/changes/page.tsx（重新扫描/排序/URL 参数/quicklog 筛选）
- frontend/src/components/mobile/mobile-change-detail.tsx（三卡挂载 + 阶段联动）
- frontend/src/app/m/workspaces/[id]/changes/[cid]/page.tsx（删除入口）
- 三个对应测试文件（mobile-change-card.test.tsx、m changes __tests__/page.test.tsx、[cid]/__tests__/page.m-change-detail.test.tsx）
- 模块：frontend（m/ 路由段 + components/mobile），module-impact.md 见该文件

## Wave 1（串行：helper 导出，task-02 的前置）

- task-01

## Wave 2（并行：三个互不共享文件的功能块）

- task-02
- task-06
- task-07

## Wave 3（串行：共享 m/changes/page.tsx，三个列表功能依次改）

- task-03

## Wave 4（依赖 Wave 3 同文件串行）

- task-04

## Wave 5（依赖 Wave 4 同文件串行）

- task-05

## Wave 6（汇总测试：依赖 task-02~07 全部完成）

- task-08

## 验收

- AC-01（FR-01）：移动列表页可触发重新扫描，成功显示统计反馈条，警告时显示警告卡，失败中文报错
- AC-02（FR-02）：卡片呈现负责人三态/执行用量两档判空/活动徽标/影响组件空省略
- AC-03（FR-03）：筛选抽屉排序切换生效进 query key；?tab=/?search= 初始化；默认参数与改造前逐字一致
- AC-04（FR-04）：quicklog 抽屉状态/作者/占位筛选生效（key 与桌面 QuicklogTable 同构）
- AC-05（FR-05）：详情页挂载最后信号（无信号不渲染）/用量卡/范围对账卡
- AC-06（FR-06）：阶段节点可点筛选时间线、可清除、无步骤阶段不可点
- AC-07（FR-07）：删除入口权限门控 + 确认弹层 + 成功回列表 + 失败中文 toast
- AC-08：相关测试文件全绿 + `pnpm exec tsc --noEmit` 0 错误
- 验证命令：`cd frontend && pnpm test -- <相关测试文件>` + `pnpm exec tsc --noEmit`

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02, task-03, task-04, task-05, task-06, task-07 | AC-01~AC-07（全部落在两页范围内） |
| D-002@v1 | （非目标约束） | 任务区不含 /m/ 任务路由改造；引导条保留 |
| D-003@v1 | task-01, task-02, task-03, task-04, task-05 | AC-01~AC-04 |
| D-004@v1 | task-06, task-07 | AC-05~AC-07 |
| D-005@v1 | task-02, task-06（复用挂载直接体现） | 全部任务实现方式约束 |
