---
id: task-07
title: 前端测试 + verify 回归
author: qinyi
created_at: 2026-08-04 13:11:27
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06]
requirement_ids: [FR-08]
decision_ids: []
allowed_paths:
  - frontend/src/components/agent-profile/__tests__/
  - frontend/src/components/__tests__/
  - frontend/src/app/(dashboard)/agent-profiles/__tests__/
---

## 目标

> 为卡片墙组件、重做表单、全局页补前端测试,跑 tsc/eslint/pnpm test 全量回归,对照 design §12 验收 7 条逐项核对达成;顺手登记 R-02 回写事项。覆盖 FR-08 与全局验收。

## 实现要点

- 卡片墙组件渲染与搜索筛选交互测试
- 系统预置档只读态测试(无编辑删除按钮)
- 全局页工作区上下文 sourcing 测试(选定工作区后能力区 mcp/policy 有数据)
- 重做表单双栏实时预览与人设预览弹窗测试
- 跑 tsc --noEmit 与 eslint src 必须 0 error,跑 pnpm test 全量(含 menu-permissions.test.ts 计数,task-05 已同步)
- Docker rebuild 实测核心页(全局卡片墙、新建表单、任务页选档下拉)
- 登记 R-02,回写事项为 FRONTEND_PAGE_STYLE.md 补 agent-profile 卡片与双栏 Modal 特例说明
## 验收标准
- 新增前端组件与页面测试全部通过
- tsc --noEmit 与 eslint src 均 0 error
- pnpm test 全量通过
- design §12 验收标准 7 条对照达成(菜单/聚合筛选/越权/表单预览/只读/端点行为/工具链)
- R-02 回写事项已登记,archive 阶段同步 FRONTEND_PAGE_STYLE.md
## 约束
- 不改非本变更测试逻辑,除非 mock 缺字段按规则 20 顺手补
- verify 真实执行不绕过,hook 拦截必修复后提交
- 兼容 Windows、Linux、macOS
## verify
`cd frontend && pnpm exec tsc --noEmit && pnpm exec eslint src && pnpm test`
