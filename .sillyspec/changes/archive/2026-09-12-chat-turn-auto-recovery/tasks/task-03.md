---
id: task-03
title: 'Wave 1 backend：协议与数据层（DTO/migration/列表 origin/gen:types）'
title_zh: 'Wave 1 backend：协议与数据层'
author: 'qinyi'
created_at: 2026-09-12 11:12:00
priority: P0
depends_on: []
blocks: ['task-04','task-05','task-06','task-07']
requirement_ids: ['FR-1.3','FR-3.7','FR-4.1','FR-5.0']
decision_ids: ['D-002@v2','D-008@v2','D-009@v2']
allowed_paths:
  - backend/app/modules/daemon/model_error.py
  - backend/app/modules/agent/model.py
  - backend/migrations/versions/20260912110000_add_scheduled_message_origin.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router/session_queue.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
target_files:
  - backend/app/modules/daemon/model_error.py
  - backend/app/modules/agent/model.py
  - NEW:backend/migrations/versions/20260912110000_add_scheduled_message_origin.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router/session_queue.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
goal: >
  design §7/§8/§5.6：①ModelErrorDTO +reset_at: str | None = None（error_detail model_dump 自动
  携带）；②AgentSessionScheduledMessage +origin TEXT NULL（'auto_resume:<源 run uuid>'，NULL=用户
  预约；类 docstring 补口径）；③migration 20260912110000 线性追加（down_revision=当前 head
  1d763051eb15，downgrade 对称 drop）；④ScheduledMessageRead（schema.py）+origin；排队列表 DTO
  （SessionQueueEntry/_queue_entry_dto 实际在 router/session_queue.py:34/:52——plan 审查 P1-1 核实）+origin；
  ⑤pnpm gen:types 重生成 openapi.json + api-types.ts（含 reset_at 与两处 origin）。
implementation: >
  按 goal 实施。gen:types 前置健康检查（CLAUDE.md 规则 21：pnpm exec tsc --version 能跑）。
  排队 DTO 已核实落 router/session_queue.py（plan 审查 P1-1）；如执行期发现其余定义处再最小扩展。
acceptance: >
  alembic upgrade/downgrade 干净单头；agent+daemon 模块既有测试零回归；openapi.json/api-types.ts
  含三处新字段；前端 tsc 通过。
constraints: >
  soft-add 双向兼容（旧 daemon 不传→None）；migration down_revision 接 1d763051eb15；禁止动
  9-10 既有 queued origin 语义。
verify: '验收标准见 acceptance 字段'
base_commit: '39d13bd4cbd3c9f198b8e24058951cf548dfa3cd'
head_commit: ''
---

## 验收标准

migration up/down 单头干净；三处新字段进 openapi+api-types；既有测试零回归；tsc 过。
