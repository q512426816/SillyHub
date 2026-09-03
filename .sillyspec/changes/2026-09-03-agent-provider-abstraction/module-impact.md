---
author: qinyi
created_at: 2026-09-04 00:05:00
---
# 模块影响分析（Module Impact）— 通用 Agent 接入抽象（AgentEvent 契约 + Provider 注册表）

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| sillyhub-daemon:types | 修改 | AgentEvent 类型联合扩 8 型 + 一等可选字段（保持纯类型文件） |
| sillyhub-daemon:agent-event-schema | 新增 | zod schema（types.ts 纯类型约束的配套运行时校验） |
| sillyhub-daemon:interactive | 修改+新增 | claude-events.ts 归一化器（新）；providers.ts 注册表+caps（新）；driver.ts 契约演进（TurnMessageEnvelope/InteractiveProvider 推导）；claude-sdk-driver.ts/codex-app-server-driver.ts 事件化；session-manager.ts status 分发改造+瘦身；types.ts 随 registry 演进 |
| sillyhub-daemon:daemon | 修改 | daemon.ts onTurnMessage 接线 agent_event 上报 + usage lift + SILLYHUB_LEGACY_TEXT_EVENTS 开关 |
| sillyhub-daemon:client | 修改 | hub-client.ts submitMessages 类型签名支持 agent_event 形态（运行时载荷不变） |
| sillyhub-daemon:cli | 修改 | cli.ts SDKMessage 类型接线改为 AgentEvent（752-771 一带） |
| backend:daemon | 修改 | run_sync/service.py：submit_messages 双轨分支 _persist_agent_event（文本行合成/结构化列/metadata_/override 撤回/usage 实时/session pin）+ SSE payload 增 agent_event 字段；session/service.py 门控查表化 |
| backend:agent | 新增+修改 | provider_caps.py 能力矩阵镜像表+查询（新）；_extract_sdk_messages 不删不改（兼容轨） |
| frontend:agent-log | 修改 | normalize.ts 双轨（agent_event 优先/文本协议回退，旧解析冻结不动） |
| frontend:components-daemon | 修改 | session-panel.tsx provider 门控改查 provider-caps（行为不变） |
| frontend:lib | 新增 | provider-caps.ts 能力矩阵镜像表 |
| docs | 新增 | docs/agent-provider-onboarding.md 三档接入清单 |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| sillyhub-daemon/tests/fixtures/claude-sdk-messages/ | golden fixture 目录（task-03 建、task-12 扩），测试资产非模块 |
| sillyhub-daemon/tests/interactive/golden/、各新测试文件 | 测试资产，各 task allowed_paths 承载 |
| .sillyspec/changes/2026-09-03-agent-provider-abstraction/* | 本变更产物（含 research-multica-agent-adaptation.md 调研沉淀） |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/sillyhub-daemon.md`（types/interactive/daemon/client/cli） | execute/verify 后补 AgentEvent 契约、providers 注册表、归一化器、legacy 开关语义说明 | pending（verify 阶段执行） |
| `modules/backend.md`（daemon/agent 模块） | 补 _persist_agent_event 双轨分支与 provider_caps 说明 | pending（verify 阶段执行） |
| `modules/frontend.md`（agent-log/components-daemon/lib） | 补 normalize 双轨与 provider-caps 说明 | pending（verify 阶段执行） |
| `_module-map.yaml` | 无增删模块（新文件均落既有模块路径）；main_symbols 可在 verify 阶段补 ClaudeEventNormalizer/INTERACTIVE_PROVIDERS | pending（verify 阶段评估） |
