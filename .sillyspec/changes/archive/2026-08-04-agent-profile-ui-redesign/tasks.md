---
author: qinyi
created_at: 2026-08-04 16:48:00
---

# 任务清单（Tasks）

> 变更 `2026-08-04-agent-profile-ui-redesign`。本文件只列任务名,执行细节(Wave 分组 / 依赖 / 步骤)在 plan 阶段展开。

## 后端

- task-01: 后端聚合端点 `GET /api/agent-profiles?scope=mine`(router.py 加端点 + `AgentProfileAggregatedItem` DTO,profile 模块 DTO 统一在 router.py)
- task-02: service `list_visible_all(actor)` 跨工作区可见性并集(逐档 `_can_read_async`,join workspace 取 name,platform 去重)
- task-03: 后端越权防护测试(actor A 不见 B 的 private / 非成员 ws 的 workspace 级 / owner-left-ws 边界)
- task-04: `pnpm gen:types` 同步 openapi.json + api-types.ts(规则 20)

## 前端数据层

- task-05: `lib/agent-profiles.ts` 加 `listMineAgentProfiles` fetch + `useMineAgentProfiles` hook + 聚合类型导出

## 前端组件

- task-06: `agent-profile-card.tsx` 角色卡(头像/名/可见/模型/人设摘要/能力/版本/操作,系统预置只读态)
- task-07: `agent-profile-card-grid.tsx` 卡片墙(搜索框 + 三筛选下拉 + 网格,全局页与 ws 内页复用)
- task-08: `agent-profile-preview.tsx` 人设预览弹窗(system_prompt 原文 + 模拟 CLAUDE.md 顶部片段)
- task-09: 重做 `agent-profile-form.tsx`(宽弹窗双栏左填右预览,字段三组,全局页「工作区上下文」选择器 listWorkspaces 数据源)
- task-10: `agent-profile-select.tsx` 视觉对齐(换 antd Select,逻辑不变)

## 前端页面/路由

- task-11: 新增全局页 `/agent-profiles`(卡片墙 + 全局聚合)
- task-12: 重构 `workspaces/[id]/agent-profiles/page.tsx` 复用卡片墙 + workspace 预筛
- task-13: `lib/menu-permissions.ts` agent section 加 agent-profiles 菜单条目(permissions:[])
- task-14: `app-shell.tsx` MENU_ICON_MAP 加 `/agent-profiles` lucide 图标
- task-15: `workspaces/[id]/page.tsx` 快捷入口保留(l:361)

## 收尾

- task-16: 前端组件/页面测试 + `tsc --noEmit` + `eslint` 0 error
- task-17: verify 对照 design 验收标准(7 条)+ 越权测试 + Docker rebuild 实测核心页
