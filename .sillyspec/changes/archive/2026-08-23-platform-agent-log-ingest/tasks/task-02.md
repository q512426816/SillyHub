---
id: task-02
title: 'backend-endpoints-tests'
title_zh: '后端接口层：schema + service + POST/GET /agent-logs + pytest'
author: qinyi
created_at: 2026-08-23 05:18:00
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001, D-004, D-005]
allowed_paths:
  - backend/app/modules/platform_sync/schema.py
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/tests/test_agent_log_push.py
goal: >
  实现 CLI 上报契约的两个端点：POST /api/agent-logs（写，仅 shpsync_，幂等批量 upsert）
  与 GET /api/agent-logs（读，scope 过滤 + last_seen_at 倒序），行为与协议文档 §1 和
  quicklog-entries 范式逐字同构，配齐鉴权矩阵/幂等/隔离/排序测试。
implementation:
  - schema.py 新增：AgentLogEntry（model_config extra="ignore"；harness Field(max_length=32) 必填、log_path Field(min_length=1, max_length=1024) 必填、其余 optional）、AgentLogPushRequest（schema_version int=1 / pushed_at / agent_cwd / scan_run_id optional / entries list[AgentLogEntry] Field(min_length=1, max_length=50)；不声明 workspace_id 字段——body 值被 ignore 吞掉，token 派生唯一权威）、AgentLogPushOk（ok=True + upserted int）、AgentLogListItem（3.1 全列 snake_case）、AgentLogListResponse（items + total 可选）
  - service.py 新增 upsert_agent_log_entries(workspace_id, entries, pushed_at, scan_run_id)：逐条 select 后 insert/update（整行覆盖含 created_at 保留），单事务一次 commit，返回落库行数；list_agent_logs(workspace_id, allowed_workspace_ids, filter_workspace_id, limit)：workspace_id 单值或 IN 并集聚合 + 可选 filter_workspace_id 等值 AND，order_by col(last_seen_at).desc().nulls_last()，limit
  - router.py 新增两端点（挂既有 router，无新 prefix）：POST "/agent-logs" 用 _write_auth，scope.workspace_id None → 403 fail-closed（对齐 quicklog-entries :338-341）；GET "/agent-logs" 用 _read_auth + workspace_id: uuid.UUID | None = Query(None) + limit: int = Query(20, ge=1, le=100)，_read_args 翻译 scope
  - test_agent_log_push.py 新建：SAMPLE body 对齐协议 §1 示例（codex rollout 条目）；用例——无凭据 401 / apikey 403 / JWT 403 / shpsync 200 落库字段全断言；同 body 二推一行（幂等覆盖 invocations/size 变化）；entries 多条 + 同 log_path 后者胜；另一 workspace 插同 log_path 不撞约束；缺 harness 或 log_path 422 + body 多余 workspace 键宽松 200；GET shpsync 单 workspace 过滤 + JWT 越权 workspace_id 空列表 + last_seen_at 排序断言
acceptance:
  - 新用例全绿（≥12 个），既有 platform_sync 套件零回归
  - 协议契约一致：POST 任意 2xx 即成功语义（200 + ok/upserted）；GET 排序 NULLS LAST
  - ruff/mypy 干净
verify:
  - cd backend && uv run pytest app/modules/platform_sync/tests -q
  - cd backend && uv run ruff check app/modules/platform_sync && uv run mypy app/modules/platform_sync
constraints:
  - 写端点鉴权三形态语义逐字对齐 quicklog-entries（401/403/403 fail-closed），不得新开鉴权路径
  - 服务端不自行累加 invocations（CLI 留底文件是计数权威，D-005）
  - 排序必须显式 nulls_last（PG/SQLite 方言分叉，X-07）
  - 中文注释/docstring（仓规 UI 与文档中文；机器链路报错英文在 l10n 排除清单 platform_sync 内）
---

# task-02 补充说明
无。
