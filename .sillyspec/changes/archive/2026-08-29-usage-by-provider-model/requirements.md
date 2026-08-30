# requirements — 用量统计细化到供应商/模型 + 会话页模型级联选择

author: qinyi
created_at: 2026-08-29 02:37:13

## FR-01 用量按供应商×模型落库（明细行）

- FR-01-1 新表 `agent_run_model_usage`：`run_id`（FK agent_runs, on delete cascade）、`model`（varchar 128）、`input_tokens` / `output_tokens` / `cache_read_tokens` / `cache_creation_tokens`（int, 0 基线）、`api_requests`（int, ≥1）。唯一键 `(run_id, model)`，同一 run 同模型幂等覆盖（终态 upsert）。
- FR-01-2 `agent_runs.llm_provider_id` / `agent_runs.model` 在 run 终态（close_interactive_run / complete_lease）填充：interactive 取会话当前 llm_provider_id + model_usage 中最大消耗行的 model；batch 取 lease ProviderConfig 的 provider id + model。
- FR-01-3 interactive：daemon 终态 payload 新增 `model_usage: [{model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, api_requests}]`，数据源 = SDK `result.modelUsage`（camelCase→snake 映射）逐模型一行；modelUsage 缺失/空时回退单行（model 取 run 会话配置的 model 或 "unknown"，四维 = 已上报的聚合值）。
- FR-01-4 batch：daemon complete stats 新增 `model`（ProviderConfig.model，空则 "unknown"）与 `api_requests`；backend 落 run 级单行明细。
- FR-01-5 老兼容：daemon 老版本不报 model_usage / api_requests → 明细表无行、requests 计 NULL（前端显示 "—"），不阻塞 close。

## FR-02 API 调用次数统计（含子代理全口径）

- FR-02-1 interactive：daemon 在 turn 消息流统计 assistant 消息数（每条 = 一次模型调用；子代理消息带 parent_tool_use_id 一并计数），随终态 payload `api_requests` 上报。
- FR-02-2 batch：daemon 统计 message_start 事件数（stream_event），随 complete stats `api_requests` 上报。
- FR-02-3 口径标注：前端展示处注明「API 调用次数（含子代理），与套餐计费口径可能略有出入」。

## FR-03 会话页配置条改造（四块 → 两块 + 级联）

- FR-03-1 session-config-bar 移除「机器」「智能体」两个展示块；保留「供应商+模型」与「档案」两块。机器信息不再展示（pre-session-picker 新会话入口不受影响）。
- FR-03-2 供应商块升级级联：选中供应商后出现模型子下拉；候选 = 该供应商 `model` + `default_fallback_model` + `model_role_mappings` 各角色 model 值（去重，保序）+ 固定首项「默认（跟随供应商配置）」；供应商「不指定（本机默认）」时模型子下拉隐藏。
- FR-03-3 切换链路：injectSession 扩展 `model` 参数（空串 = 跟随供应商配置）→ backend 会话 ProviderConfig.model 更新 → daemon 会话 reload（ANTHROPIC_MODEL env 注入已有链路，daemon 侧零新增）；仅切模型（供应商不变）也走 reload。
- FR-03-4 状态展示：config_snapshot.model 有值时展示当前模型名；Codex 引擎供应商块维持锁定（D-010）。
- FR-03-5 预会话（provisional）模式同步支持级联暂存。

## FR-04 运行时用量卡分组展示

- FR-04-1 `GET /runtimes/usage` 响应新增 `by_provider: [{provider_id, provider_name, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, api_requests}]`（窗口内 agent_run_model_usage 明细 JOIN llm_providers + agent_runs 过滤，口径与现有 summary 同窗同去重）。
- FR-04-2 前端 runtime-card 用量区新增分组明细（按供应商×模型列表，展示四维 + 调用次数），provider/model 缺失归「未记录」。
- FR-04-3 现有 summary/daily 双线图与数字保持不变（零回归）。

## NFR

- NFR-01 全链路兼容 Windows/Linux/macOS（daemon 计数与 env 注入均为纯 JS）。
- NFR-02 统计 SQL 沿用现有 LEFT JOIN+COALESCE 去重模式（interactive run 双挂 session+lease 不重复计）。
- NFR-03 前端接口类型经 `pnpm gen:types` 生成，禁手写。
- NFR-04 UI 中文（FR-02-3 口径标注等）。

## 验收口径

- 真实会话（含子代理）跑一轮后：agent_run_model_usage 出现 ≥1 行且四维总和 == run 四维；api_requests ≥ turn 内 assistant 消息数。
- 会话页切换供应商+模型后发起对话，CLI 实际收到 ANTHROPIC_MODEL=所选模型（daemon 日志/env 验证）。
- runtimes 用量卡出现分组明细且窗口切换（1d/7d/30d）数值随动。
