---
id: task-06
title: 设置页瘦身（移除 EntryCard + providers Tab，默认 Tab 改工作区信息）
title_zh: 设置页移除重复入口实现瘦身
author: qinyi
created_at: 2026-07-30 09:06:13
priority: P0
depends_on: [task-03]
blocks: [task-07]
requirement_ids: [FR-04]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/settings/page.tsx
goal: >
  设置页只保留平台级配置（工作区信息/智能体配置/安全策略/集成），移除与侧边栏重复的 4 个 EntryCard 卡片入口与 providers Tab 及 LlmProviderSection 引用，消除双入口，供应商功能由 task-03 的独立页面接管。
implementation:
  - 删除 EntryCard 组件定义（含其 ReactNode 类型与 Link 用法）及主页面中 4 个卡片入口 JSX（技能管理/MCP配置/API密钥/Git身份）
  - 删除不再使用的 import（next/link、lucide 的 Boxes/BookOpen/KeyRound/Network、LlmProviderSection）
  - Tab 类型收窄为 workspace、agent、security、integrations 四值；TABS 数组删 providers 项
  - 默认 Tab 从 providers 改为 workspace；删除 tab 等于 providers 时的 LlmProviderSection 渲染分支
  - 保留 WorkspaceTab/AgentConfigTab/SecurityTab/IntegrationsTab/KVRow 及 health 拉取逻辑原样
acceptance:
  - 设置页渲染后无卡片入口区，Tab 栏只有工作区信息/智能体配置/安全策略/集成 4 个
  - 打开 /settings 默认落在工作区信息 Tab，无 providers 分支与 LlmProviderSection 残留引用
  - 文件内 grep 不到 EntryCard 与 LlmProviderSection，typecheck 通过无未使用 import
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm vitest run
constraints:
  - 仅改 settings/page.tsx 一个文件，不动其他页面与组件
  - 依赖 task-03 的 /settings/providers 独立页已建好才可移除原 Tab，防止入口真空
  - /settings/skills 与 /settings/mcp 等现有路由路径保持不变，仅删设置页内的重复入口
---
