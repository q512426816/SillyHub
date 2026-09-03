---
plan_level: full
---

# 实现计划（Plan）：通用 Agent 接入抽象（AgentEvent 契约 + Provider 注册表）

## Wave 1（并行，无依赖——契约与能力表）
- task-01
- task-02

## Wave 2（依赖 W1——归一化器与注册表）
- task-03
- task-04
- task-05

## Wave 3（依赖 W2——driver 接入与 backend 接收）
- task-06
- task-07

## Wave 4（依赖 W3；波内顺序：task-08 → task-09）
- task-08
- task-09

## Wave 5（依赖 W4——前端双轨与门控收敛）
- task-10
- task-11

## Wave 6（依赖 W5——测试收口与文档）
- task-12
- task-13
- task-14

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | AgentEvent v2 类型扩展与 zod schema | W1 | P0 | — | FR-01 | types.ts 类型联合+一等字段；agent-event-schema.ts 独立 zod（types.ts 保持纯类型） |
| task-02 | ProviderCaps 三端镜像表与守护测试 | W1 | P1 | — | FR-06 | daemon providers.ts 的 caps 定义 + backend provider_caps.py + frontend provider-caps.ts + 源文件读取对齐测试 |
| task-03 | ClaudeEventNormalizer 归一化器 | W2 | P0 | task-01 | FR-02, D-002@v1, D-004@v1 | claude-events.ts 有状态类：完整展开（移植 _extract_sdk_messages）+ partial/override（移植 session-manager flush 链）+ depth 状态机 + status subtype 事件化（含 bash_chunk） |
| task-04 | CodexAppServerDriver flat→AgentEvent 映射 | W2 | P1 | task-01 | FR-02 | event_type→type 映射表；toFlatMessage 已半具备（driver:33-35/426-435） |
| task-05 | providers.ts 注册表与 InteractiveProvider 推导 | W2 | P0 | task-01, task-02 | FR-05, D-002@v1 | ProviderDescriptor（family 复用 adapters 6 协议联合/caps/预留 envKeys/contextFile）；_getDriver 改读注册表；interactive/types.ts 的 CreateSessionInput/SessionManagerDeps 类型随 registry 演进 |
| task-06 | driver.ts 契约演进与 ClaudeSdkDriver 接入归一化器 | W3 | P0 | task-03 | FR-02, D-002@v1 | TurnMessageEnvelope（events+调试 raw）；InteractiveDriverResult 结构化 usage/session_id；driver 改用 normalizer |
| task-07 | backend _persist_agent_event 分支与 SSE 透传 | W3 | P0 | task-01 | FR-03, D-004@v1 | run_sync/service.py：kind 识别/文本行合成/结构化列/metadata_/override 撤回/usage 实时/session pin 无行化；publish payload 增 agent_event；旧路径兼容轨保留 |
| task-08 | SessionManager status 分发改造与瘦身 + cli.ts 接线 | W4 | P0 | task-06 | FR-02, D-002@v1, D-003@v1 | _onMessage 消费中性事件（subtype 分发对账表覆盖现 10+ 类消费面）；seq 补号/usage lift；raw 依赖清零；cli.ts:752-771 类型接线 |
| task-09 | daemon.ts 接线与 hub-client 载荷 + legacy 回退开关 | W4 | P0 | task-08 | FR-01 | kind:'agent_event' 上报；SILLYHUB_LEGACY_TEXT_EVENTS=1 强制旧形态（默认关） |
| task-10 | 前端 normalize.ts 双轨 | W5 | P0 | task-07, task-09 | FR-04 | agent_event 字段优先构造渲染模型；无则回退文本协议解析 |
| task-11 | 三端 provider 门控收敛查表 | W5 | P1 | task-02, task-05 | FR-06 | session-panel.tsx（附件/派工/resume/vision）+ backend daemon/session/service.py 散落 === 'claude' 改查 caps，行为不变断言 |
| task-12 | golden 三源对照测试收口 | W6 | P0 | task-03, task-07, task-09 | FR-02, D-003@v1, D-004@v1 | 真实 SDK 消息序列 fixture：normalizer 输出 ≡ 三处现状实现联合语义（完整展开+partial flush+落库行）；覆盖 partial→override→撤回、实时 usage、子代理归属 |
| task-13 | 双路径渲染等价 fixture 测试 | W6 | P0 | task-10 | FR-04 | 同一事件序列两种载荷（旧文本行 vs agent_event 行）双路径 normalize，渲染模型树等价（忽略 log_id/timestamp）——Claude 零回归判据 |
| task-14 | docs/agent-provider-onboarding.md 三档接入清单 | W6 | P1 | task-05 | FR-07 | 换 wrapper 零代码/族内描述符/新协议族 driver+归一化器+注册，含升级顺序约定（backend 先于 daemon） |

## 关键路径
task-01 → task-03 → task-06 → task-08 → task-09 → task-10 → task-13（7 节点最长链：契约→归一化→driver→会话层→上报→前端双轨→渲染等价收口）

## 全局验收标准
1. 相关模块测试全绿（daemon vitest / backend pytest / frontend vitest，仅跑本变更相关，全量留 CI）
2. golden 三源对照通过（task-12）+ 双路径渲染等价通过（task-13）
3. 旧 daemon（无 kind 键）/旧前端（无 agent_event 字段）兼容轨行为与现状一致（task-07/10 内断言）
4. codex 交互式会话在新契约下工作（task-04/08 手测清单）
5. （brownfield）P2 门控收敛为纯重构：caps 表 claude/codex 取值与原硬编码逐一相等（task-11 断言）

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-07, task-09, task-10 | 双轨兼容（legacy 开关/兼容轨）+ 全局验收 3 |
| D-002@v1 | task-03, task-05, task-06, task-08, task-11 | status subtype 分发对账表 + raw 清零 |
| D-003@v1 | task-07, task-08, task-12 | usage 实时更新+SSE 透传断言 |
| D-004@v1 | task-03, task-07, task-12 | override 撤回链 golden 用例 |
| FR-01 | task-01, task-09 | 类型+zod 一致性测试；载荷共存 |
| FR-02 | task-03, task-04, task-06, task-08 | golden 对照 |
| FR-03 | task-07 | _persist_agent_event 行为对齐 |
| FR-04 | task-10, task-13 | 双路径等价测试 |
| FR-05 | task-05 | 注册表条目不改类型 |
| FR-06 | task-02, task-11 | 三端对齐守护+行为不变断言 |
| FR-07 | task-14 | 文档存在+三档 checklist |
