---
id: task-08
title: execute 阶段 team toggle + lib 透传
title_zh: 前端 execute team 开关
author: qinyi
created_at: 2026-07-12 11:01:04
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-2]
decision_ids: [D-002, D-003]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
  - frontend/src/lib/changes.ts
---

## 目标

execute 阶段加紫色 team toggle，透传 team_mode 到后端 transition 链路。

**注意 plan 漏列**：plan task-08 只列 page.tsx，但 toggle 值传后端必经 lib/changes.ts（本 TaskCard 扩范围）。

## 实现要点

1. **page.tsx**：
   - 加 state `const [teamMode, setTeamMode] = useState(false)`（:168 附近，跟 stageProvider/stageModel 同区）。
   - UI：在 provider/model 输入区（:640-655）下方加紫色 Switch/Checkbox「用团队执行（多 worker 并行写，需 GLM）」。仅 execute 流转时条件渲染（参照 gatePanel :611-638 的 stage 条件）。
   - 透传：handleGateAction 的 `transition_execute` 分支（:483-491）+ handleExecute（:311）把 teamMode 传入对应 lib 调用。
2. **lib/changes.ts**：
   - `transitionChange`（:269-296）：加 `teamMode?: boolean` 参数，true 时附加 `body.team_mode=true`。
   - `executeChange`（:247-261）：加 `teamMode?: boolean` 参数，true 时拼进 query（`team_mode=true`）。
3. 紫色开关对齐 mission-console task-04 的 team 紫色风格（violet-500）。

## 验收标准

- execute toggle 切 team（紫）→ transitionChange/executeChange 传 team_mode=true。
- 默认 false（零回归）。
- `pnpm typecheck` 过。

## verify

```
cd frontend && pnpm typecheck
```

## 约束

- 只改 page.tsx + lib/changes.ts。
- 默认 false（D-003）。
- 紫色对齐 task-04 mission-console 风格。
