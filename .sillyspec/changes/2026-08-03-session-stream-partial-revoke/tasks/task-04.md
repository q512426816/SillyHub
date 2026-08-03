---
id: task-04
title: daemon.ts SessionStreamEnvelope(:711) 加 segment_id: string|null + stale: boolean 字段（前端本地类型，免 gen:types）
title_zh: 前端 SSE envelope 类型加 segment_id + stale
author: WhaleFall
created_at: 2026-08-03 10:23:11
priority: P0
depends_on: []
blocks: [task-05, task-06, task-07]
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/lib/daemon.ts
provides:
  - contract: SessionStreamEnvelope（frontend/src/lib/daemon.ts:711）
    fields: [segment_id: string|null, stale: boolean]
expects_from:
  - contract: backend SSE session envelope segment_id / stale（task-01 透传 + task-02 override stale=True）
goal: >
  前端 SessionStreamEnvelope 类型补 segment_id 与 stale 字段，作为 task-05/06/07 识别「半截 / override 撤回令箭」的类型基础。
implementation:
  - daemon.ts:711-735 SessionStreamEnvelope 接口在 cache_*  字段之后追加 segment_id: string | null（非空=partial 半截；null=complete/其他）。
  - 同接口追加 stale: boolean（默认 false；override 撤回令箭行 true）。
  - 两字段均设为必填（非可选）：与 backend envelope 始终下发对齐（complete 行 segment_id=null、stale=false）；旧 backend 缺字段时由运行时 undefined 兜底（design §9 兼容策略，TS 层不放宽为可选避免 task-05/06 反复写非空守卫）。
  - 加 JSDoc 注释说明语义来源（task-01 透传 log_entry.segment_id；task-02 override stale=true），供下游 onLog 直接判 env.segment_id / env.stale。
acceptance:
  - SessionStreamEnvelope 含 segment_id: string | null 字段（partial 行非空、complete/其他行 null）。
  - SessionStreamEnvelope 含 stale: boolean 字段（override 行 true、其余 false）。
  - 字段语义注释清晰，指向 design §5 Phase2 / §7.2。
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec eslint src/lib/daemon.ts
constraints:
  - SessionStreamEnvelope 是前端本地手写类型（非 OpenAPI 生成，design §2.4 / D-003：DTO 不加 segment_id），本任务免跑 pnpm gen:types。
  - 不改 AgentRunLogEntry DTO（历史 GET 不返回 segment_id，design §2.4 / §3 非目标），仅实时 SSE envelope 有此字段。
  - 不放宽为可选字段（?: ）—— backend 始终下发，可选会让 task-05/06 反复写 env.segment_id ?? null 守卫，违背「类型驱动」。
---
