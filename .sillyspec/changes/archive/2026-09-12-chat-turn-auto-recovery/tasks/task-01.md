---
id: task-01
title: 'Wave 1 daemon：classifier 泛化 + resetAt + wire 映射'
title_zh: 'Wave 1 daemon：classifier 泛化 + resetAt + wire 映射'
author: 'qinyi'
created_at: 2026-09-12 11:12:00
priority: P0
depends_on: []
blocks: ['task-07']
requirement_ids: ['FR-1.1','FR-1.2','FR-1.3','FR-1.4']
decision_ids: ['D-001','D-002@v2','D-011']
allowed_paths:
  - sillyhub-daemon/src/model-error/classifier.ts
  - sillyhub-daemon/src/model-error/types.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/model-error/classifier.test.ts
target_files:
  - sillyhub-daemon/src/model-error/classifier.ts
  - sillyhub-daemon/src/model-error/types.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/model-error/classifier.test.ts
goal: >
  design §5.1：①移除「agent 非 claude→unknown」门控（classifyClaude 更名 classifyBlob 唯一规则体，
  agent 参数仅日志归因）；②provider_error 规则体补断流关键词（stream ended / without finish_reason /
  stream truncat / silent stream / 输出流中断 / 流中断）——「Stream ended without finish_reason」
  主实证必须命中；③extractResetAt：仅 quota_exceeded 命中时解析 GLM 中文「将于 YYYY-MM-DD HH:MM:SS
  重置」（固定 +08:00 标注），英文变体/解析失败 null；④types.ts ModelError +resetAt: string | null；
  ⑤daemon.ts payload.error 注入处解构剔除 camel 键注入 snake 键 reset_at（design §5.5 序列化跳）。
implementation: >
  按 goal 五点实施；其余七条规则原文不动（429 优先、auth/model_not_found/network 顺序不变）；
  claude 行为唯一变化=断流关键词修复（NFR-1 口径）。pi rpc「response timeout」核过命中既有 timeout
  规则无需新增。测试扩入既有 tests/model-error/classifier.test.ts（base_commit 已存在，plan 审查 P1-3 核实——262258fd0 建）覆盖：pi 断流文本归 provider_error、
  GLM 429 中文文案归 quota_exceeded + resetAt 解析（含 +08:00 断言）、英文变体 resetAt=null、
  claude 既有八类零回归、断流文本不误命中 auth/timeout。
acceptance: >
  sillyhub-daemon pnpm test（model-error 套件）+ pnpm typecheck 绿；断流/429 解析/零回归用例全过；
  wire 映射后 payload.error 无 camelCase resetAt 键（单测断言）。
constraints: >
  见 design §5.1/§5.5 与 D-002@v2/D-011；禁止越 allowed_paths；规则优先级链不得重排（429 先于其他
  4xx/5xx）。
verify: '验收标准见 acceptance 字段'
base_commit: '39d13bd4cbd3c9f198b8e24058951cf548dfa3cd'
head_commit: ''
---

## 验收标准

pnpm test model-error 套件 + typecheck 绿；断流文案归 provider_error、GLM 429 resetAt 解析（+08:00）、英文变体 null、claude 零回归；wire 键剔除断言过。
