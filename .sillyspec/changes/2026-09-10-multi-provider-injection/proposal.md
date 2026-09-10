---
author: qinyi
created_at: 2026-09-10 23:05:00
---
# 提案书（Proposal）

## 动机

平台供应商体系（llm_provider 用户级凭证/加密/set-default/WS 热切换）已完整，但 daemon 侧凭证注入只覆盖 claude：codex 会话的供应商来自宿主 `~/.codex/config.toml`（平台切换不生效）；pi 经并行变更落了 env 层但自定义端点被显式 punt。本变更按 spike 实测事实（`spike/spike-report.md`，前置 design 而非调研推断）补齐 codex 完整注入 + pi 自定义端点文件层。配套方案 `docs/proposal-config-management-capability-2026-09-10.md` §4（P0-B）。

## 关键问题

1. **codex 断层**：切换供应商对 codex 会话零生效；凭证无法下发（spike 证 env 路不通——二进制无 OPENAI_BASE_URL）
2. **pi 自定义端点缺口**：env 层不携带 base_url（并行变更边界），自定义端点供应商（智谱/GLM 等经自有端点）无法注入
3. **cursor 不可行确认**：spike 证私有 ConnectRPC 云协议无 BYO 面（`--api-key` 是 Cursor 云 key），结论入档避免后续重复调研

## 变更范围

- codex-settings.ts：per-session `CODEX_HOME`（D-011）写 auth.json+config.toml（保守合并、wire_api=responses 唯一值、per-form 映射 anthropic/openai_chat 两形态）
- pi-settings.ts：per-session `PI_CODING_AGENT_DIR` 三文件（官方 auth 形状 `{"type":"api_key","key":...}`、api="openai-completions" golden、preserve unknown；与 env 层 auth.json>env 压制共存）
- 两接线点（daemon.ts interactive + task-runner.ts batch）+ applyClaudeSettings kind 守卫 + PROVIDER_CONFIG_CHANGED 按会话精准重写（尽力语义 D-009）
- backend schema agent_kind 增 codex（仅 Create 一处）+ pi×openai_chat 禁配（service 层 Update 侧）+ 前端表单（codex 选项/pi 端点字段/openai_chat 禁选）

## 不在范围内（显式清单）

- 不做 cursor（spike C：无注入面，D-007）
- 不做 codex env 注入（spike A1：路不通）；不做 codex 直连 anthropic（v2，litellm 通道兜底）
- 不重复 pi env 层/schema pi 词表/前端 pi 选项（并行变更已做，D-008 分层）
- 不改 lease 协议/ProviderConfig 形状/表结构；不新增 WS 消息类型
- 不做 gemini（注册表预留仍在）

## 成功标准（可验证）

- codex：per-session 目录产物与 spike A2 golden 逐字段一致；openai_chat 形态全字段落盘（litellm_base_url/litellm_model_name/daemonApiKey）；provider_config absent 时行为与现状逐字一致（测试锁定）
- pi：三文件形状/spike golden/preserve unknown/仅 base_url 非空写；pi+openai_chat 422
- 写盘失败语义：记 error 跳过（含 env 注入一并跳过）仍 spawn=行为等同未配置，W1 单测锁定
- 真实 CLI 冒烟（W5，integration-critical 预期）：mock 端点 codex/pi 各一条端到端
- 时序：execute 前置检查 review-dispatch-platform-fixes 已合并 main（D-008）
