---
id: task-06
title: 'e2e verification with evidence'
title_zh: '端到端验证（上行幂等/指标对拍/渲染实证/老 daemon 零影响）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 22:20:00
priority: P0
task_type: verification
depends_on: [task-04, task-05]
blocks: [task-07]
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-007, D-008@v3, D-009]
allowed_paths:
  - backend/app/modules/knowledge/router.py
  - sillyhub-daemon/src/spec-sync.ts
  - .sillyspec/changes/2026-09-20-knowledge-effect-panel/
target_files: []
goal: >
  端到端验证：真实 hits 上行幂等、指标对拍、四卡与卡片流渲染、fr zone、老 daemon 零影响，证据落 evidence 目录。
implementation:
  - dev 栈或服务器触发 daemon 同步使 hits 全量上行，再重跑同步重报验证计数不变
  - stats 指标手工复算对拍（覆盖率分子分母、死条目数、密度、榜头 per_task）
  - 浏览器验证四卡、死条目抽屉、榜 % 格式、三形态卡片、互跳、原文 tab、fr 组
  - 未升级 daemon 场景空态验证
  - 证据命令输出与截图与 SQL 计数写 evidence/task-06-evidence.md
acceptance:
  - 重报幂等两次全量上行后行数与指标不变
  - 指标对拍一致且 slug 归一化生效（手册条目命中非零）
  - 卡片流三形态与 fr zone 与原文 tab 浏览器实证
  - 老 daemon 空态零报错
verify:
  - cd backend && uv run pytest app/modules/knowledge -q
  - cd sillyhub-daemon && pnpm test
constraints:
  - 不改业务源码（发现问题回对应 task 修后复验）
  - 失败项如实记录不粉饰
---
