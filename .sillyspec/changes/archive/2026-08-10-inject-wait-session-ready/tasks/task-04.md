---
id: task-04
title: api-types.ts gen:types 同步新端点
title_zh: 同步 session ready 端点类型到 daemon api-types
author: WhaleFall
created_at: 2026-08-07 14:32:00
priority: P1
depends_on: [task-07]
blocks: []
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/api-types.ts
  - backend/openapi.json
expects_from: {}
goal: >
  把后端新 POST session ready 端点的 TS 类型同步进 daemon 侧 src/api-types.ts，文件
  头已声明 auto-generated，必须生成不手写（CLAUDE.md 规则 20）。
implementation:
  - 前置确认 backend/openapi.json 已含 session ready 端点（task-06 加端点加 task-07 dump 完成；当前仅有 inject recover end 无 ready，未就绪则阻塞等 task-07）
  - 健康自检 daemon node_modules，sillyhub-daemon 跑 pnpm exec tsc --version，报错或 bin 缺 shim 则 pnpm install --force 重建
  - sillyhub-daemon 跑 pnpm gen:types（等于 node scripts/gen-api-types.mjs，消费 backend/openapi.json 写 src/api-types.ts，脚本不重新 dump），随后 pnpm exec tsc --noEmit 校验
acceptance:
  - src/api-types.ts 的 paths 接口含 session ready 端点路径，文件头仍为 auto-generated 注释无手写
  - pnpm exec tsc --noEmit 在 sillyhub-daemon 零报错
  - 不手写不微调 api-types.ts
verify:
  - cd sillyhub-daemon && pnpm gen:types
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 禁止手写或微调 api-types.ts，必须 gen:types 生成（CLAUDE.md 规则 20）
  - node_modules 半坏必须 pnpm install --force 修复不得绕过
  - 纯类型同步不改 daemon 业务逻辑，不提前改 hub-client 调用方（task-01 才消费类型）
  - 不在 daemon 侧 dump openapi.json（dump 由 task-07 在 backend 侧完成）
---
