# proposal — 用量统计细化到供应商/模型 + 会话页模型级联选择

author: qinyi
created_at: 2026-08-29 02:37:13

## 背景与动机

token 统计修复（ql-20260829-001/002）后数值已可信，但统计粒度只有 runtime 维度总量，无法回答「智谱 GLM 和 Kimi 各用了多少」「glm-4.7 和子代理模型各消耗多少」。同时部分 coding plan 按请求次数收费，平台缺少调用次数统计。会话页配置条（session-config-bar）只有供应商选择、无模型选择——用户想用同供应商的不同模型（如 glm-4.7 / glm-4.6）需要去改供应商配置，体验断裂。

## 现状事实（调研结论）

- `agent_runs` 已有 `provider` / `llm_provider_id` / `model` 三列 + `agent_sessions.llm_provider_id` FK，**但从未写入真实值**（provider 列存的是 agent_kind"claude"，model 全空）。
- interactive 终态 SDK `result.modelUsage` 天然 **per-model 分账**（含子代理，实测 `{"glm-4.7":{input:49273,...}}`）；ql-20260829-002 目前把它加总后丢弃了明细。
- modelUsage 无 requestCount 字段；调用次数需 daemon 在消息流计数（每 API 调用一条 message_start/assistant 消息，含子代理；实测 2×message_start == num_turns==2 吻合）。
- batch 侧模型名可从 lease ProviderConfig 取；CLI stream-json 的 result 无 model 字段。
- 模型注入链路已存在：ProviderConfig.model → credential-injector 规则3 → `ANTHROPIC_MODEL` env；`inject_session` 已有 llm_provider_id 参数可同模式扩展 model。
- 供应商编辑高级设置已有完整模型体系：4 角色映射（sonnet/opus/fable/haiku × model 名）+ default_fallback_model + 「获取模型列表」（/v1/models 拉取）。
- session-config-bar 四控件 = 机器（展示，预会话时选择）/ 智能体（纯展示引擎名）/ 供应商（可切换）/ 档案（可切换）；新会话入口是独立的 pre-session-picker（①机器②智能体两步），**不受本次会话页底部条改动影响**。

## 目标

1. **统计细化**：用量（input/output/cache_read/cache_creation）按 供应商×模型 落库并在运行时用量卡分组展示；新增 API 调用次数统计（含子代理全口径）。
2. **会话页模型选择**：配置条改为 供应商+模型级联 / 档案 两块（移除机器、智能体展示块）；模型候选来自该供应商高级设置配置的模型集合。
3. 存量兼容：老 run（无 provider/model）归「未记录」桶；老 daemon 不报明细时回退 run 级单行。

## 不在范围内 / Non-Goals

- 不做新独立统计页面（用户已选：现有 runtimes 用量卡扩展）。
- 不改 pre-session-picker（新会话入口的机器/智能体两步流程保持）。
- 不做费用核算/按套餐计费（total_cost_usd 维持 CLI 估算，不引入价格表）。
- 不做供应商编辑页的「模型列表持久化」（获取模型列表仍仅表单内即拉即用；会话级联候选来自已保存的角色映射/兜底模型字段）。
- 不做 batch 任务配置页的模型选择（batch 沿用 ProviderConfig；本次只补落库）。
- 不处理 Codex 引擎的供应商/模型（D-010 锁定语义保持不变）。

## 方案概要

- **daemon（上报扩展）**：interactive 终态 payload 新增 `model_usage[]`（model + 四维 + requests）与 `api_requests`（消息流 assistant 计数，含子代理）；batch complete stats 新增 `model`（ProviderConfig.model）与 `api_requests`（message_start 计数）。
- **backend（落库+统计）**：新表 `agent_run_model_usage`（run_id × model 明细行）；`agent_runs.llm_provider_id/model` 在 close 链路填充；`GET /runtimes/usage` 响应新增 `by_provider`（供应商×模型分组 + requests）。
- **frontend（两处）**：session-config-bar 移除机器/智能体块、供应商块升级级联（模型候选 = 供应商 model_role_mappings 各角色 model + default_fallback_model + model 去重）+ injectSession 传 model；runtime-card 用量区分组明细展示。

## 规模评估

scale=large（跨 daemon/backend/frontend 三端 + schema 变更 + 统计口径扩展）。
