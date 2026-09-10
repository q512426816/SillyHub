---
author: qinyi
created_at: 2026-09-10 21:05:00
---

# 提案书（Proposal）

## 动机

sillyspec 仓 review-dispatch（tier=independent 独立审查平台派发）已全流程交付并活体验证，今天两轮真派发暴露三个平台侧问题，直接削弱该通道的核心价值主张（「本地配额耗尽/宿主无 Agent 时平台兜底」）：worker 结论拿不到结构化产出、平台 worker 与本地 agent 同配额池互锁、派发前无法判断生效执行器。

## 关键问题

1. **PI worker 结论未沉淀为 artifacts（P0）**：mission 77470369 实证 `get_worker_result` 返回 `artifacts: []`，结论只在日志流。根因三连：interactive 子会话路径不经 batch 的 collect_completed_artifacts 通道；PI driver turn result 无 `result` 字段（output_redacted 恒空）；pi 无原生 MCP 无法自报 worker_done。
2. **配额池不独立（P0，架构级）**：本地 agent 子代理与平台 pi worker 同账号配额池（429 code 1308 同时锁死，15:30-18:31 全通道瘫痪实证）。病灶：llm_providers schema 锁死 claude kind + daemon injector REGISTRY 无 pi → pi 的 provider_config 被跳过、落回本机凭证。
3. **default_agent 置空致白跑（P1）**：dispatch_worker 回退 claude（本机无 claude CLI 白跑一轮），且 get_daemon_status 不暴露执行器信息，调用方派发前无可判面。

## 变更范围

- Wave 1（P0-1）：PI driver 轮终 assistant 全文进 turn result；daemon onTurnResult 对 `stage=mission_worker` 且 `caps.mcp===false` 的会话在成功终态（notifyRunResult 之后）fire-and-forget 代报 `worker_done`（X-Session-Id 承载分身身份，summary=全文）→ 落 `AgentArtifact(kind=summary)`。
- Wave 2（P0-2）：backend llm_provider schema 放开 `agent_kind=pi` + `auth_field` 泛化 env 名；daemon 新增 PiCredentialInjector 并注册（spawn-env 第 0 层承接）；前端表单启用 pi 预留项。
- Wave 3（P1-3）：get_daemon_status 响应增 `default_agent`/`effective_agent`/每 daemon `providers`。

## 不在范围内（显式清单）

- 不改 sillyspec 仓（消费侧双通道提取与空 artifacts 兜底已就绪并实证正确）
- 不动 batch lease 的 artifact 通道（对 batch 已工作）
- 不为 pi 实现 litellm_proxy/hub 网关形态（pi 不读 BASE_URL env，自定义端点走宿主 models.json，文档说明边界）
- 不做 workspace 直挂 llm_provider_id 列（零 DDL，workspace 级经 default_agent_profile_id 既有链路）
- 不引入 AgentArtifact.kind 新值/枚举（沿用 summary）
- 不做 pi 热切换专项验证（claim 现算已够，既有链路不回归即可）

## 成功标准（可验证）

- 单测：PI driver success result 带 `result`=轮终 assistant 全文（override 事件驱动、轮重置、error 轮不带）；daemon mission_worker 门控/时序/参数/容错；Pi injector 映射与 REGISTRY；backend schema pi 可建 + auth_field pattern 拒非法 + claude 旧值零回归；get_daemon_status 三新字段。
- 类型门禁：daemon `pnpm typecheck`、backend schema 测试、frontend `pnpm gen:types` 后 tsc 无新错、daemon `gen:types:check` 零漂移。
- 兼容：未建 pi 凭证时 pi 会话行为与现状逐字一致（provider_config 缺省→第 0 层跳过）；claude worker 自报路径与 artifacts 零变化。
- 活体回归（用户在远端环境执行，交付文档给口径）：review-dispatch 真派发 `--status` 走到 completed 且 `get_worker_result` artifacts 非空、可提取 review JSON；本地配额耗尽时段平台派发仍能跑（独立 pi 凭证生效）。
