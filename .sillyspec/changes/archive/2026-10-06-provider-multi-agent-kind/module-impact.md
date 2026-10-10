# 模块影响分析（Module Impact）— 供应商 agent_kinds 多引擎集合化

> 真相源：scope-audit.json（execute --done 时点冻结，baseAnchor=d1dc7907d，patchSha256=be79f82b…，63 文件全部 verdict=planned）。
> 骨架由 plan --done CLI 生成；矩阵/归属/影响类型由 archive 终审步按 _module-map.yaml paths 前缀 + git diff 逐行裁决回填。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| llm_provider | backend/app/modules/llm_provider/model.py | 数据结构变更（agent_kind 单值列 → agent_kinds JSON 列） | 否 |
| llm_provider | backend/app/modules/llm_provider/schema.py | 接口变更（agent_kinds list[str] 保序去重 + pi×openai_chat 集合级 422；Read DTO 删单值字段） | 否 |
| llm_provider | backend/app/modules/llm_provider/service.py | 逻辑变更（默认互斥逐引擎清兄弟/扩张清新增引擎兄弟；update 合并态禁配判定） | 否 |
| llm_provider | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | 新增（多选往返/组合禁配用例） | 否 |
| llm_provider | backend/app/modules/llm_provider/tests/test_agent_kinds_migration.py | 新增（迁移双方言往返用例） | 否 |
| llm_provider | backend/app/modules/llm_provider/tests/{test_llm_provider,test_api_format,test_fetch_models,test_llm_provider_pi_kind,test_quota,test_router,test_usage}.py | 逻辑变更（fixture/断言字段 agent_kind=x → agent_kinds=[x] 波及） | 否 |
| daemon | backend/app/modules/daemon/lease/context.py | 逻辑变更（resolve_default/bound 集合命中 + 下发 agent_kind 恒盖会话引擎） | 否 |
| daemon | backend/app/modules/daemon/lease/provider_switch.py | 逻辑变更（notify_provider_switch 按会话引擎分组扇出；NULL provider 跳过告警） | 否 |
| daemon | backend/app/modules/daemon/session/service/inject_gates.py | 逻辑变更（创建/turn 双段 not-in-集合 422） | 否 |
| daemon | backend/app/modules/daemon/protocol.py | 逻辑变更（注释/DTO 文档串语义同步，无行为变化） | 否 |
| daemon | backend/app/modules/daemon/tests/{test_change_session,test_e2e_model_usage_flow,test_group_cross_mention,test_group_p1,test_inject_first_turn_briefing,test_inject_orchestrator_tagging,test_inject_session_model,test_lease_context_provider_priority,test_lease_model_usage,test_provider_switch,test_provider_switch_integration,test_resolve_bound_provider_config,test_resolve_default_provider_config,test_runtime_usage_by_provider,test_session_create_config,test_session_fork,test_session_optimize_round2,test_session_queue,test_session_reopen,test_session_runs_endpoint,test_session_switch_config,test_control_command_dispatch}.py | 逻辑变更（fixture agent_kind=x → agent_kinds=[x] 波及，约 2 行/个） | 否 |
| agent | backend/app/modules/agent/schema.py | 逻辑变更（注释/DTO 文档串语义同步，无行为变化） | 否 |
| mcp_gateway | backend/app/modules/mcp_gateway/tools.py | 逻辑变更（MCP 池描述符 agent_kind 键取池引擎值） | 否 |
| mcp_gateway | backend/app/modules/mcp_gateway/tests/test_tools_new.py | 逻辑变更（字段口径同步） | 否 |
| session_attachment | backend/app/modules/session_attachment/capability.py | 逻辑变更（默认供应商查询集合命中） | 否 |
| session_attachment | backend/app/modules/session_attachment/tests/test_capability.py | 逻辑变更（fixture 字段口径同步；review.json 注记 grep 无 agent_kind 引用，改动为 fixture 联动） | 否 |
| frontend_lib | frontend/src/lib/api/llm-providers.ts | 接口变更（类型/归一化 agent_kinds 化） | 否 |
| frontend_lib | frontend/src/lib/api-types.ts | 接口变更（OpenAPI 重生成，禁手写） | 否 |
| frontend_lib | frontend/src/lib/api/__tests__/llm-providers.test.ts | 逻辑变更（字段口径同步） | 否 |
| frontend_components | frontend/src/components/llm-providers/llm-provider-form.tsx | 接口变更（引擎多选 Checkbox.Group + openai 禁 pi 前置 + 收缩空缺 toast） | 否 |
| frontend_components | frontend/src/components/llm-providers/llm-provider-list.tsx | 接口变更（列表多徽标） | 否 |
| frontend_components | frontend/src/components/sessions/session-config-bar.tsx | 逻辑变更（供应商过滤口径单值→includes） | 否 |
| frontend_components | frontend/src/components/agent-profile-form.tsx | 逻辑变更（档案表单过滤口径 includes） | 否 |
| frontend_components | frontend/src/components/llm-providers/__tests__/{llm-provider-form,llm-provider-form-apiformat,llm-provider-form-fetch-config,llm-provider-list}.test.tsx | 逻辑变更（多选/禁配/收缩用例） | 否 |
| frontend_components | frontend/src/components/sessions/__tests__/{session-config-bar,ctx-usage-bar}.test.tsx | 逻辑变更（字段口径同步） | 否 |
| frontend_components | frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx | 逻辑变更（mock 字段口径同步） | 否 |
| frontend_components | frontend/src/components/__tests__/agent-profile-form.test.tsx | 逻辑变更（mock 字段口径同步） | 否 |
| frontend_app | frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx | 逻辑变更（mock 字段口径同步） | 否 |
| frontend_app | frontend/src/app/m/workspaces/[id]/sessions/[sid]/__tests__/page.m-session-chat.test.tsx | 逻辑变更（mock 字段口径同步） | 否 |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths（backend/migrations、backend/tests、仓库级生成物本就不属于特性模块管辖，判定为正常游离、非索引过期）：

- `backend/migrations/versions/20261006120000_provider_agent_kinds.py` — 新增（数据迁移：单值→JSON 数组双方言 + 索引 drop/rebuild + 对称 downgrade）；migrations 目录为全局数据层，不入特性模块
- `backend/openapi.json` — 配置变更（OpenAPI 规范重生成物，随 schema 改动同批提交）
- `backend/tests/modules/daemon/lease/test_provider_config_payload.py` — 逻辑变更（跨模块集成测试目录，字段口径同步）；backend/tests/** 为集成测试区，不入特性模块

## 终审裁决记录（三重核对两类不一致）

1. **diff 有而 module-impact 未列（271 项）**：主仓区间并集（baseAnchor 起）含 2026-10-06 以来其它并行/后续变更的文件。本变更真实文件面以 scope-audit.json 冻结清单（63 行，全部 planned，patchSha256 校验 ok）为准，63 行已全部列入上方矩阵与未匹配章节；其余约 228 个区间文件属其它变更（2026-10-09-attachment-inline-reference、2026-10-10-borrow-sandbox-workspace-context、2026-10-10-task-wakeup-quiet-threshold 及已归档变更），与本变更无关，不列入。另 verify 对账已排除 3 个并行会话声明文件（test_session_queue.py / test_init_claim_tokens.py / sillyhub-daemon/src/daemon.ts），其中 test_session_queue.py 在本变更 63 行内（fixture 波及 2 行），并行变更叠加改动不影响归属判定。
2. **module-impact 列而 diff 无（1 项：_module-map.yaml）**：系「更新结果」表行内说明字符串被核对器识别为文件声明，_module-map.yaml 非本变更文件，无需处理。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 不适用：本变更未新增模块/目录，paths/depends_on/used_by 无结构变化（llm_provider/daemon/frontend 均为既有模块面内改动） | skipped |
| `modules/llm_provider.md` | 契约摘要/关键逻辑同步：agent_kinds 集合列、逐引擎默认互斥（含扩张清新增引擎兄弟）、pi×openai_chat 组合禁配、索引变更、unset 多引擎广播语义 | done |
| `modules/daemon.md` | 定位节两处同步：resolve 归属校验 agent_kind 一致 → agent_kinds 集合命中；热切换按会话引擎分组扇出 | done |
| `modules/frontend_components.md` | llm-provider-form 条目字段口径 agent_kind → agent_kinds（引擎多选） | done |
| `modules/agent.md` / `modules/mcp_gateway.md` / `modules/session_attachment.md` / `modules/frontend_lib.md` / `modules/frontend_app.md` | 不适用：卡片无 agent_kind 字段级描述，本次为面内实现/测试口径变化，语义层无新增可维护信息 | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
