---
id: task-03
title: CreateMissionInput 加 mode/session_id 字段
title_zh: 前端 mission 创建 input 加 mode/session_id
author: qinyi
created_at: 2026-07-12 10:41:54
priority: P1
depends_on: []
blocks: [task-04]
requirement_ids: [FR-1]
decision_ids: [D-003]
allowed_paths:
  - frontend/src/lib/agent.ts
---

## 目标

前端 createMission 的 input 类型加 mode/session_id 可选字段，对齐后端 MissionCreateRequest（task-01）。

## 实现要点

1. 编辑 `frontend/src/lib/agent.ts` 的 `CreateMissionInput`（约 :250-263，当前 4 字段 objective/change_id/budget_usd/constraints）。
2. 追加：
   ```typescript
   mode?: "single" | "team" | null
   session_id?: string | null
   ```
3. createMission（:258）POST body 序列化时这俩字段随 input 一起发送（undefined 时 JSON.stringify 自动忽略；后端 schema 默认 None 放行）。

## 验收标准

- CreateMissionInput 含 mode + session_id 可选字段。
- `pnpm typecheck` 过。
- 不改 createMission 调用逻辑（只加字段）。

## verify

```
cd frontend && pnpm typecheck
```

## 约束

- 只改 agent.ts 的 CreateMissionInput，不动其他类型/函数。
- 不改 api-types.ts（生成文件；mission-console 用手写 CreateMissionInput 不依赖生成类型；生成类型同步留债，不阻塞 Wave 1）。
