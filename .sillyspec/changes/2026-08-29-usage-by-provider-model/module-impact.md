# module-impact — 2026-08-29-usage-by-provider-model

author: qinyi
created_at: 2026-08-29 03:05:00

## 受影响模块

| 模块 | 影响面 | 变化类型 | 波及测试 | 文档 |
|---|---|---|---|---|
| backend/agent | model.py 新增 AgentRunModelUsage ORM；既有 AgentRun 两列开始被填充（无 schema 变更） | 扩展 | test_run_sync_model_usage / test_lease_model_usage（新） | backend.md 变更索引 |
| backend/daemon（schema/契约） | InteractiveRunResultRequest 增可选 model_usage[]/api_requests；RuntimeUsageRead 增 by_provider → openapi.json + api-types.ts 再生 | 契约扩展（可选字段，向后兼容） | 既有契约测试 | backend.md |
| backend/daemon（run_sync） | close_interactive_run 明细 upsert + run 列填充（llm_provider_id 仅空时，R-08） | 行为扩展（无新字段时零变化） | test_run_sync_model_usage（新）+ 既有 run_sync 套件 | backend.md |
| backend/daemon（lease） | complete_lease stats 落单行明细 | 行为扩展 | test_lease_model_usage（新）+ 既有 lease 套件 | backend.md |
| backend/daemon（runtime 统计） | get_runtimes_usage 增 by_provider（新 JOIN 查询） | 只读扩展（summary/daily 零回归） | test_runtime_usage_by_provider（新）+ test_runtime_usage_service 既有 | backend.md |
| backend/daemon（session/inject） | inject_session 扩 model 参数 + 兜底模型快照同步（R-07） | 参数扩展（空串=现状） | test_inject_session_model（新）+ 既有 inject 套件 | backend.md |
| sillyhub-daemon（daemon.ts） | modelUsage 明细拆行 + assistant 计数 + payload 两字段 | 上报扩展（modelUsage 缺失不写，老链路兼容） | daemon-interactive-bridge（补） | sillyhub-daemon.md |
| sillyhub-daemon（adapter/task-runner/hub-client） | message_start 计数 + batch model/requests + body 透传 | 上报扩展 | stats-passthrough / stream-json（补） | sillyhub-daemon.md |
| frontend/sessions | session-config-bar 四块→两块 + 供应商模型级联；lib/daemon.ts injectSession 扩参 | UI 结构变化（移除两块）+ 新交互 | session-config-bar.test（改+补） | frontend.md |
| frontend/runtimes | runtime-card/helpers by_provider 分组明细 | 展示扩展 | page-usage.test（mock 补字段） | frontend.md |
| frontend/类型 | api-types.ts 再生（消费新契约） | 生成物 | tsc | — |

## 跨模块契约点

- daemon → backend：终态 payload 新增可选字段（model_usage[]/api_requests/model）——双方必须同批发布前对齐 schema（task-02 契约先行）；老 daemon 对新 backend：字段缺省走兼容分支。
- backend → frontend：by_provider 响应 + inject model 请求参数，经 OpenAPI 生成类型（NFR-03）。
- credential-injector env 链路（default_fallback_model 快照同步，R-07）：backend 快照组装点 ↔ daemon injector 优先级语义，task-11/13 联调验证。

## 不受影响

- pre-session-picker、Codex 供应商锁定（D-010）、RuntimeUsageLineChart、既有 summary/daily 口径、llm_providers 表结构、daemon 会话生命周期（claim/heartbeat/lease 状态机）。
