---
id: task-02
title: aggregate mine fetch/hook + gen:types sync
title_zh: 聚合 fetch/hook 与 gen:types 同步
author: qinyi
created_at: 2026-08-04 13:11:27
priority: P0
depends_on: [task-01]
requirement_ids: [FR-02]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/lib/agent-profiles.ts
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
expects_from:
  - task-01 已落地 AgentProfileAggregatedItem DTO 与 GET /api/agent-profiles?scope=mine 端点并写入 openapi.json
  - 该 DTO 在 AgentProfileRead 全字段之外 needs workspace_id 与 workspace_name 两字段供前端筛选与卡片展示
provides:
  - contract listMineAgentProfiles 裸 fetch 命中聚合端点返回聚合档案数组
  - contract useMineAgentProfiles hook 返回 profiles 供 task-03/04/05 卡片墙表单页面消费
goal: >
  前端封装跨工作区聚合只读 fetch 与 React Query hook 并导出聚合类型，同时跑 pnpm gen:types 把后端新增 mine 端点与 DTO 同步进 api-types.ts 与 openapi.json，为下游 task-03/04/05 提供类型安全的数据源。
implementation:
  - 先确认 frontend node_modules 健康跑 pnpm exec tsc --version 验证半坏则 pnpm install --force 修复后再跑 pnpm gen:types 同步 openapi.json 与 api-types.ts 遵守规则 20
  - 在 lib/agent-profiles.ts 新增 agentProfileQueryKeys.mineList 全局单桶 key 仿现有 platformList 写法
  - 新增 listMineAgentProfiles 调 apiFetch 取 /api/agent-profiles?scope=mine 返回聚合数组 resp.items 空兜底
  - 新增 useMineAgentProfiles hook 用 useQuery staleTime 30s 对齐现有 workspace 级 hook 返回 profiles isLoading isError error refetch
  - 导出 type AgentProfileAggregatedItem 取自 components schemas 禁手写
acceptance:
  - gen:types 成功且 api-types.ts 出现 AgentProfileAggregatedItem schema 含 workspace_id 与 workspace_name 字段
  - hook 返回 profiles isLoading isError 三态空数据兜底空数组
  - 全部类型从 api-types.ts 取无手写 DTO
verify:
  - cd frontend 然后 pnpm exec tsc --noEmit 零类型错误
constraints:
  - 类型一律从 api-types.ts 取遵守规则 20 禁手写 DTO
  - staleTime 30s 对齐现有 useWorkspaceAgentProfiles 不引入新刷新策略
  - queryKey 走 agentProfileQueryKeys.mineList 不散落字符串
---
