---
id: task-03
title: schema additive fields (kind/event_type/owner_name) plus gen:types regeneration
title_zh: schema 增量——StepTimelineEntry.kind/event_type + ChangeSummary/ChangeRead.owner_name + gen:types 重生成（openapi.json + api-types.ts 同 commit）
author: qinyi
created_at: 2026-08-16 11:40:00
priority: P0
depends_on: [task-01, task-02]
blocks: [task-04, task-05]
requirement_ids: [FR-03, FR-04]
decision_ids: []
allowed_paths:
  - backend/app/modules/change/schema.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
provides:
  - contract: StepTimelineEntry
    fields: [kind, event_type]
  - contract: ChangeSummary/ChangeRead
    fields: [owner_name]
  - contract: components.schemas.StepTimelineEntry（frontend/src/lib/api-types.ts，pnpm gen:types 产物）
    fields: ["kind?: string（\"step\" | \"event\"，缺省视为 step）", "event_type?: string | null"]
  - contract: components.schemas.ChangeSummary
    fields: ["owner_name?: string | null（display_name 优先 username fallback，enrich 批量填）"]
goal: >
  change 模块契约层增量（design §5 Phase 2.3 + §7）：StepTimelineEntry 加
  kind（默认 "step"，"step"|"event"）与 event_type optional；ChangeSummary/
  ChangeRead 各加 owner_name optional（全 optional 零 breaking，§9 兼容策略）。
  随后 pnpm gen:types 重生成 backend/openapi.json + frontend/src/lib/
  api-types.ts（design §6 漏列 openapi.json 由本 task 认领，plan task-03 行），
  三文件同 commit pathspec 限定，为 task-04 读侧投影与 task-05 前端提供类型契约。
implementation:
  - schema.py:43 StepTimelineEntry 追加两字段，字段名与 design §7 逐字——kind：str 默认 "step"（"step" | "event" 两值；事件条目由 task-04 时间线合成时置 "event"，本 task 只落契约）；event_type：str | None = None（首类值 'owner_change'，后续事件类型零 schema 变更接入，D-002@v1 扩展点）。注释标注来源（2026-08-16-change-owner-from-token task-03）+ 计算投影语义（kind 默认 "step" → 旧数据旧组件零影响，§9）
  - ChangeRead（:61）与 ChangeSummary（:93）各追加 owner_name：str | None = None——owner_id 的用户可读投影（display_name 优先 username fallback），由 service enrich 批量填充是 task-04 领地，本 task 仅落契约；注释对齐 step_progress 既有 optional 字段注释范式（计算字段/非表列/零 migration/brownfield 安全）
  - 不动 StepTimelineEntry.output 的"截断 200 字"注释与逻辑（Phase 2.4 截断两层分离归 task-04，plan task-04 行明示同步修该注释）
  - gen:types 环境：execute worktree 无 frontend/node_modules（CLI 不链接）——PowerShell New-Item Junction 主仓 frontend/node_modules 到 worktree 同路径，勿 pnpm install 重装；跑前自检 node_modules 健康（pnpm exec tsc --version 能跑 + node_modules/.bin 有 openapi-typescript shim；半坏症状=假 CSSProperties/Cannot find module 报错 → 主仓 pnpm install --force 修复后重建 junction）
  - cd frontend && pnpm gen:types（内部先在 backend 跑 uv run python scripts/dump_openapi.py 刷 backend/openapi.json，再 openapi-typescript 生成 src/lib/api-types.ts）；防 worktree 陷阱：dump 后核对 openapi.json 已含新字段——若缺=venv editable install 指向主仓 app 漏 worktree 改动，设 PYTHONPATH=<worktree>/backend 重跑（sillyhub-platform-sync 既有坑）
  - grep 验证三字段落型：src/lib/api-types.ts 中 grep -c "kind"、grep -c "event_type"、grep -c "owner_name" 各 ≥1（StepTimelineEntry 段含 kind/event_type；ChangeSummary 与 ChangeRead 两段各含 owner_name）
  - 三产物同 commit：backend/app/modules/change/schema.py + backend/openapi.json + frontend/src/lib/api-types.ts 一并提交，git commit 用 pathspec 限定（git commit -m ... -- <三文件>，多 agent 并发防裹挟他者 staged）；提交前 git status --short 核对 index，提交后 git show --stat HEAD 复查仅含三文件
acceptance:
  - api-types.ts 含三个新字段：StepTimelineEntry.kind / StepTimelineEntry.event_type / ChangeSummary.owner_name + ChangeRead.owner_name（grep 各 ≥1，由后端 schema 经生成器真实透出）
  - schema 新字段全 optional（kind 有默认 "step"，event_type / owner_name 默认 None），现有 ChangeRead / ChangeSummary / steps 消费方零 breaking（§9：旧前端不读新字段渲染不变，kind 默认值兜底）
  - 生成器产物无手写：api-types.ts 与 openapi.json 均为 pnpm gen:types 产出，重跑后 git diff 干净（gen:types:check 守门等价），无任何手工编辑痕迹
  - schema.py 与两生成产物在同一 commit（契约与前端类型不分离，不留类型落后后端的债，CLAUDE.md 规则 21）
verify:
  - cd backend && uv run mypy app/modules/change/schema.py
  - cd backend && uv run ruff format --check app/modules/change/schema.py
  - cd frontend && pnpm gen:types
  - cd frontend && grep -c "kind" src/lib/api-types.ts（≥1）；grep -c "event_type" src/lib/api-types.ts（≥1）；grep -c "owner_name" src/lib/api-types.ts（≥1）
  - cd frontend && pnpm typecheck（tsc --noEmit 0 错误）
constraints: >
  字段名逐字 kind / event_type / owner_name（design §7，task-04/05 消费依赖，
  拼写漂移=契约断裂）；api-types.ts 禁止手写，只由 gen:types 产出（CLAUDE.md
  规则 21）；worktree 无 node_modules 用主仓 junction，勿 pnpm install；gen:types
  前确认 node_modules 健康（半坏→pnpm install --force）；owner_name 填充逻辑
  与时间线合成归 task-04，前端渲染归 task-05（本 task 仅契约+codegen）；output
  截断注释/逻辑不动（Phase 2.4 归 task-04）；三产物同 commit 且 pathspec 限定
  （防裹挟他者 staged）。
---
