# 模块影响分析（Module Impact）— 智能体档案绑定供应商配置

变更：`2026-08-11-agent-profile-bind-llm-provider`。AgentProfile 新增 `llm_provider_id`（FK→`llm_providers.id`，ondelete=SET NULL，nullable）；daemon/lease 凭证注入改四级判断（绑定优先→用户默认→D-007 本机）；前端表单第一层改名「智能体引擎」+ 第二层供应商配置联动下拉 + 卡片/预览展示绑定供应商名。

真实变更文件以 `git diff HEAD~1` 为准（真实 > 声明）。verify 一轮 FAIL→修复 task-08/10/11→PASS。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| agent | 数据结构变更 + 接口变更 + 逻辑变更 | `agent/profile/model.py`、`agent/profile/router.py`、`agent/profile/service.py`、`agent/service.py`、`agent/tests/test_profile_router.py`、`migrations/versions/20260811104500_agent_profile_llm_provider.py` | AgentProfile 加 `llm_provider_id` FK（nullable，ondelete=SET NULL）+ migration 新增列；Create/Update/Read DTO 接收/透出字段（显式 null=解绑，exclude_unset 语义）；service create/update/clone 透传；`_apply_profile_to_lease` 写 `lease.metadata["llm_provider_id"]`；test_profile_router 补 Create/Read/Update 字段断言 | false |
| daemon | 逻辑变更 + 新增 | `daemon/lease/context.py`、`daemon/tests/test_resolve_bound_provider_config.py` | `_inject_provider_config` 改四级判断（绑定优先→用户默认→D-007 本机），新增 `resolve_bound_provider_config` helper（归属校验 `provider.user_id==runtime.user_id` + agent_kind 一致性 + anthropic/openai_chat 双分支构造）；新增 6 测试类守护 | false |
| frontend_components | 接口变更 + 逻辑变更 | `agent-profile-form.tsx`、`agent-profile/agent-profile-card.tsx`、`agent-profile/agent-profile-preview.tsx`、`agent-profile/__tests__/agent-profile-card.test.tsx`、`__tests__/agent-profile-form.test.tsx` | 表单第一层 label 改名「智能体引擎」+ 第二层「供应商配置」联动下拉（按 agent_kind 过滤、codex 禁用提示、编辑态未知 id 占位不转 null）；card/preview 接入绑定供应商名展示（id→name 映射 + 非本人「（非本人供应商，将回退默认）」）；测试更新 label + 补 llm_provider_id 覆盖 + card 绑定展示 it | false |
| frontend_lib | 接口变更 | `frontend/src/lib/api-types.ts` | `pnpm gen:types` 重生成，AgentProfileCreate/Update/Read/AggregatedItem 新增 `llm_provider_id` 字段（规则 20） | false |

## 未匹配文件

| 文件 | 说明 |
|------|------|
| `backend/openapi.json` | `pnpm gen:types` 重新生成的 OpenAPI 契约快照（根级生成文件，不属单一模块；随 frontend_lib 的 api-types.ts 同步提交） |

## 说明

- **未改 `llm_provider` 模块源码**：仅消费其 `LlmProvider` 模型 / `listProviders`（模型字段、端点集合不变）。
- **未碰 lease/session/agent_run/daemon 状态机**：design §8 明确「不涉及生命周期契约」，仅在 claim 装配的 `_inject_provider_config` 增加一处凭证来源判断（多读 lease metadata 一个字段 + 一次按 id 查询），不改状态流转/事件/必需字段。
- R-02 密钥红线：档案只存 `llm_provider_id`（UUID 引用），明文 key 仍只在 encrypt/decrypt 两处。
