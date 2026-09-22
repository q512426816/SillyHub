---
id: task-02
title: 'daemon hits incremental upload'
title_zh: 'daemon hits 增量上报（offset 断点+分批+best-effort 挂点）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 22:20:00
priority: P0
depends_on: []
blocks: [task-03]
requirement_ids: [FR-01]
decision_ids: [D-003, D-007]
allowed_paths:
  - sillyhub-daemon/src/knowledge-hits-upload.ts
  - sillyhub-daemon/src/spec-sync.ts
  - sillyhub-daemon/tests/
target_files:
  - NEW:sillyhub-daemon/src/knowledge-hits-upload.ts
  - sillyhub-daemon/src/spec-sync.ts
  - NEW:sillyhub-daemon/tests/knowledge-hits-upload.test.ts
expects_from:
  task-01:
    - contract: HitsBatchOut
      needs: [ingested, skipped_bad, duplicates]
goal: >
  daemon hits 增量上报：postSpecSync 汇聚点 best-effort 钩子，offset 家目录断点，分批 ≤2000 行，多端幂等交服务端 hash 去重。
implementation:
  - 新模块读 spec 目录 .runtime/knowledge-hits.jsonl（不存在静默 no-op）；offset 状态存 daemon 家目录状态文件（不落 spec 树）；按完整行断点（尾行无换行不报）；分批 POST hits/batch 且 body 带 daemon_local_id
  - spec-sync.ts postSpecSync 汇聚点挂钩子独立 try catch best-effort，失败不阻塞同步主流程，offset 不进下轮重试由服务端 hash 去重兜底
  - ESM import 带 .js 扩展名（仓铁律）
acceptance:
  - 增量本地 append 后仅新行上报且 offset 前进；尾行截断不报留下轮
  - 上报端点 500 时同步流程照常完成不抛
  - hits 文件不存在 no-op 零日志噪音
verify:
  - cd sillyhub-daemon && pnpm test
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 不动 UPLOAD_EXCLUDE_TOP_BASE 整体排除语义（仅本地读取，不随 spec tar 上行）
  - 不改 backend（task-01 范围）
  - daemon 面全量回归 4306 基线零失败
---
