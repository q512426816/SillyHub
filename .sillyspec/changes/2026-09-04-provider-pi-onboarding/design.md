---
author: qinyi
created_at: 2026-09-04 10:25:00
scale: large
---

# 设计文档（Design）— PI 交互式 Provider 接入（档C 首个实战）

> v2（2026-09-04）：按 Design Grill（brainstorm-review-2026-09-04-105758）修订——B-01 文件清单补 cli.ts 装配行、B-02 前端引擎可选性白名单两处、B-03 session_started 改 get_state 合成、B-04 subagent 降级为示例扩展如实 false、B-05 接口骨架对齐 InteractiveDriver 实契约+turn 收敛信号+extension_ui_request 自动取消、B-06 杂项自洽。

> 上游基座：2026-09-03-agent-provider-abstraction（AgentEvent v2 契约 / INTERACTIVE_PROVIDERS 注册表 / ProviderCaps 三端镜像 / onboarding 三档路径）。本变更是档C（新交互式协议 driver）的第一个真实接入，同时是对抽象层"新增 provider 零改 SessionManager/daemon/backend/前端"承诺的验收。

## 1. 背景

平台真正可用的交互式 provider 只有 claude/codex。用户要求接入 PI（本机已装 `pi 0.81.1`，agent-detector 已探测 online，批量路径已有 pi_json 适配器），目标对齐 Claude 全部能力（8 项 caps）。差距策略经用户确认为**桥接补齐+如实标记**（D-002@v1）：原生有的全接、可桥的桥、补不了的如实 caps=false 并在交付报告列明。

## 2. 设计目标

1. PI 成为第三个交互式 provider：`pi --mode rpc` 长驻 driver，会话生命周期与 claude/codex 同款（start/consume/interrupt/close + resume）。
2. 事件归一化：pi rpc 事件流 → AgentEvent v2（复用契约与上报管线，daemon/backend/前端**零改动**）。
3. 能力矩阵如实：8 项 caps 逐项三态结论（原生/桥接/暂缺+原因），三端镜像同步。
4. 验收：onboarding §8 清单全过 + 真实 PI 会话冒烟（对照 claude 冒烟 9 项，PI 不支持项豁免记录）。

## 3. 非目标（Non-Goals）

- **不做 MCP 桥接**：pi 无原生 MCP（自家 extension 生态），本期 caps=false，硬桥留后续变更（用户已确认取舍）。
- **不做 edit_patch 合成**：pi edit 工具无结构化 patch 输出，caps=false；前端已有 LCS 回退渲染（D-006@agent-provider-abstraction 精神）。
- **不动批量 pi_json 适配器**（adapters/pi-json.ts）：交互式与批量并存，互不影响。
- **不接 omp 等 pi 族 fork**：档B 后续验证。
- **不做 pi extension 生态管理 UI**（pi install/list 等仅命令行存在）。
- **零 DB 迁移、零 OpenAPI 变化**（caps 是代码级镜像表）。

## 4. 拆分判断

单一连贯变更不拆 MASTER：driver+归一化器+注册是同一抽象目标的最小完整单元；caps 三端是随动同步。无批量模式特征。

## 5. 总体方案

### 5.1 PiRpcDriver（`sillyhub-daemon/src/interactive/pi-rpc-driver.ts` 新增）

```
SessionManager（零改动）
   └─ PiRpcDriver implements InteractiveDriver
       ├─ start(): spawn pi --mode rpc --session-dir <daemon 隔离目录>
       │           [+ --provider/--model/--thinking]
       ├─ JSONL 双向（严格 LF 分帧；禁 Node readline——U+2028/29 切分不合规，
       │            pi rpc.md 明示；自实现逐字节 \n 切分器）
       ├─ 上行命令（rpc.md 实测词汇）：
       │   prompt {message, images?, streamingBehavior?}   ← inject 主通道
       │   steer / follow_up                               ← streaming 中追加（steer 语义）
       │   abort                                           ← interrupt
       │   new_session / switch_session / fork             ← resume/会话切换
       │   set_model / get_available_models                ← model_select
       │   set_thinking_level                              ← thinking
       ├─ 下行：response（id 关联确认）+ 事件流（见 5.2）
       └─ 权限桥：rpc 无审批命令 → 不接 canUseTool（caps 如实 false）
```

关键实现点：
- **framing**：按 rpc.md 规范自写 LF 切分（对照官方 rpc-client.ts）；响应/事件按 `type` 分流（`response` 带 id 关联 pending promise；其余为 agent 事件交归一化器）。
- **inject 语义**：非 streaming 态走 `prompt`；streaming 态按 UserTurnInput 场景走 `steer`（默认）或 `follow_up`；错误响应（如 streaming 未带 streamingBehavior 被拒）转 error 事件上报。
- **resume**：`--session-id`/`switch_session`（agentSessionId 持久化沿用 SessionManager 既有 AgentSession.agent_session_id 链路；pi session 文件在隔离 session-dir 下）。
- **multimodal**：UserTurnInput.blocks 的 image/document → rpc `images: [{type:'image', data, mimeType}]`（pi ImageContent 格式；document 无对应通道则文本降级注明）。
- **session_started 合成（B-03 修正）**：rpc 模式**不发** session 首帧（那是 `-p --mode json` 打印模式专属；rpc 仅转发 AgentSessionEvent 联合，无 session 型）。driver 启动后主动发 `get_state` 取 `data.sessionId` → 合成 `status/session_started` 事件（resume 指针链路依赖它）。
- **turn 收敛信号（B-05 补）**：以 `agent_settled`（agent 停稳，含 steer/followUp 队列清空）为 turn 边界上报 onTurnResult；`turn_end` 仅作 usage 载体不触发收敛（steer 队列存在时按 turn_end 收敛会误拆 run）。
- **extension_ui_request 自动取消（B-05 补）**：pi extension 可发 dialog 类 ui_request（阻塞至应答）；permission_dialog=false 下 driver 默认回 `cancelled: true`（不答会死锁）。
- **进程管理**：对照 CodexAppServerDriver 的握手超时/退出收敛/会话级 fail 语义（子进程非正常退出触发 onError 会话 fail）。

### 5.2 PiEventNormalizer（`sillyhub-daemon/src/interactive/pi-events.ts` 新增）

rpc 下行事件流（与批量 pi_json 同词汇，`pi -p --mode json` 实测确认）→ AgentEvent v2：
- `text_delta` → `text`（pi 天然逐 delta，无 Anthropic block 缓冲——is_partial 不需要，直通完整事件）
- thinking 块（message content 内 thinking part，pi 七档）→ `thinking`
- `tool_execution_start` → `tool_use`（tool_name+call_id+args 对象）
- `tool_execution_end` → `tool_result`（call_id 配对；pi edit 工具结果为 diff 文本——无结构化 patch，不产 edit_patch）
- `error`/`extension_error`/response `success:false` → `error`；`session_started` 由 driver 的 get_state 合成（见 §5.1，rpc 无 session 首帧）
- `turn_end.message.usage` → `usage`（input/output/cacheRead→cache_read/cacheWrite→cache_creation，字段映射复用批量 pi_json 已验证口径）
- 未知事件：降级 status 事件带原值（fail-safe，不丢不抛——codex driver 同款策略）
- 全产出过 `safeParseAgentEvent` 校验（档C 清单要求）

### 5.3 注册与能力矩阵

providers.ts 加条目：`pi: { family: 'pi_json', displayName: 'PI', createDriver: () => new PiRpcDriver(), caps: capsOf('pi') }`（InteractiveProvider 联合自动扩展，无类型字面量改动）。

caps 三端镜像（daemon 单源 → backend/frontend 镜像 → 守护测试自动覆盖）：

| cap | pi 取值 | 结论 | 依据 |
|---|---|---|---|
| resume | true | 原生 | --session-id/switch_session/fork + 隔离 session-dir 实测 |
| mcp | false | 暂缺 | pi 无原生 MCP（extension 生态另轨）；桥接留后续 |
| multimodal | true | 原生 | rpc prompt images（ImageContent base64）文档+实跑 |
| thinking | true | 原生 | --thinking 七档 + set_thinking_level + thinking 内容块 |
| subagent | false（初始）→ 实证后翻 true | 桥接（示例扩展） | subagent/ 是 pi **examples/ 示例扩展非内置**（`-e` 需路径非名称）；其子代理跑 `pi -p --mode json` 子进程、消息聚合进 tool result details，父事件流无 per-child 归属——按 onboarding §6.2 纪律初始 false，R-02 实证（vendor 进 daemon 目录或解析包内路径）后翻 true |
| permission_dialog | false | 暂缺 | rpc 无审批命令，pi 权限门在 extension 层；桥接留后续 |
| edit_patch | false | 暂缺 | pi edit 无结构化 patch；前端 LCS 回退可用 |
| model_select | true | 原生 | set_model/cycle_model/get_available_models rpc 全套 |

前端/后端门控零新代码：session-panel/backend 查 caps 表自动按值裁剪（agent-provider-abstraction task-11 的红利）。

### 5.4 与抽象层承诺的对账（档C 清单 §5 逐点，B-01/B-02 修正后口径）

**四承诺区零改动**：SessionManager（status 分发/输入队列/审批桥）、daemon.ts、backend 全部、前端 caps 门控——均实读核实可行。**装配层与可选性白名单两处必改**（Grill 抓出的抽象盲区）：
1. cli.ts drivers 装配行：`_getDriver` 走 `deps.drivers` 注入而非 createDriver 工厂（session-manager.ts:1271-1290），cli.ts:754 硬编码 `{claude,codex}` → 加 `pi: new PiRpcDriver()` 一行；
2. 前端引擎可选性白名单两处：`components/sessions/pre-session-picker.tsx:44`（门户主路径）与 `runtime-session-helpers.tsx:64`（对话框路径）硬编码集合 → 加 pi；群聊两处（create-group-wizard/member-panel）本期不动记后续。
其余改动集 = 两个新文件 + providers.ts 条目 + 三端 caps + cli.ts 一行 + 前端白名单两处 + 测试 + onboarding 案例锚。

## 6. 文件变更清单

主仓单仓变更。

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | sillyhub-daemon/src/interactive/pi-rpc-driver.ts | PiRpcDriver（rpc JSONL 双向/四契约/resume/inject 三模式/abort） |
| 新增 | sillyhub-daemon/src/interactive/pi-events.ts | PiEventNormalizer（rpc 事件→AgentEvent v2） |
| 修改 | sillyhub-daemon/src/interactive/providers.ts | INTERACTIVE_PROVIDERS 加 pi 条目+PROVIDER_CAPS 加 pi 键（数据流：单源→镜像→守护测试） |
| 修改 | backend/app/modules/agent/provider_caps.py | 镜像加 pi 键 |
| 修改 | frontend/src/lib/provider-caps.ts | 镜像加 pi 键 |
| 新增 | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | driver 契约测试（mock rpc 子进程，fixture 事件序列） |
| 新增 | sillyhub-daemon/tests/interactive/pi-events.test.ts | 归一化器用例（每事件型+usage 映射+未知降级+zod 校验） |
| 修改 | sillyhub-daemon/tests/interactive/provider-registry.test.ts | 注册表断言扩展（pi 实例化/family/caps 同源） |
| 修改 | backend/app/modules/agent/tests/test_provider_caps_alignment.py | 三端对齐自动覆盖（pi 键随表生效，若断言 provider 集合需补） |
| 修改 | sillyhub-daemon/src/cli.ts | drivers 装配加 `pi: new PiRpcDriver()` 一行（B-01：_getDriver 走 deps.drivers 注入） |
| 修改 | frontend/src/components/sessions/pre-session-picker.tsx | 引擎可选性白名单加 pi（B-02 门户主路径） |
| 修改 | frontend/src/components/daemon/runtime-session-helpers.tsx | 引擎可选性白名单加 pi（B-02 对话框路径） |
| 修改 | docs/agent-provider-onboarding.md | §5 档C 增加 PI 实战案例锚；顺修档B 第 8/10 步两处盲区（EXPECTED_PROVIDERS 断言必改/装配行与白名单未列） |
| 修改 | sillyhub-daemon/src/agent-detector.ts | PROVIDER_SPECS.pi 补 minVersion '0.81.0'（R-03，档B 清单既有步骤非矛盾） |

零 DB 迁移、零 OpenAPI 变化；detector 仅补 minVersion 一字段（pi 已在 PROVIDER_SPECS）。

## 7. 接口定义

```ts
// pi-rpc-driver.ts（骨架，对齐 driver.ts 实契约 handle 形态/E5）
export class PiRpcDriver implements InteractiveDriver {
  readonly provider = 'pi' as const;              // E5：handle.provider 标识
  start(input: AsyncIterable<UserTurnInput>, options: InteractiveDriverStartOptions): Promise<InteractiveDriverHandle>;
  consume(handle: InteractiveDriverHandle, callbacks: InteractiveDriverCallbacks): Promise<void>;
      // 事件流→归一化器→onTurnMessage(envelope)；agent_settled → onTurnResult
  interrupt(handle: InteractiveDriverHandle): Promise<boolean>;  // rpc abort
  // close 在 handle 上（实契约；driver 级不另设）
}
// rpc 命令类型面：prompt/steer/follow_up/abort/new_session/switch_session/fork/
//   set_model/get_available_models/set_thinking_level/get_state/get_messages
//（完整词表见 pi 包 docs/rpc.md；分帧器 LF-only 自实现）

// pi-events.ts
export class PiEventNormalizer {
  normalizeRpcLine(line: string): AgentEvent[];   // 纯函数式逐行（pi 无跨行状态）
  // usage 映射：input/output 直传；cacheRead→cache_read_tokens；
  //            cacheWrite→cache_creation_tokens（批量 pi_json 已验证口径）
}
```

## 7.5 生命周期契约表

本变更命中 session/lease/daemon 关键词。**PI 的会话生命周期全部在 provider 内部（rpc 命令）与既有抽象层管线内完成，不新增任何跨端 wire 事件**——上行链（AgentEvent→kind:agent_event→_persist_agent_event→SSE→前端）完全复用，零新增契约。PI 特有映射：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| create session | backend（既有） | daemon PiRpcDriver | provider='pi', runtime, workspace | spawn pi --mode rpc（隔离 session-dir） |
| inject（prompt/steer/follow_up） | SessionManager（既有） | PiRpcDriver | UserTurnInput{text, blocks?} | streaming 态按 steer/follow_up 语义排队 |
| interrupt | SessionManager（既有） | PiRpcDriver | — | rpc abort → turn 终态 |
| resume | backend（既有） | PiRpcDriver | agent_session_id | --session-id/switch_session |
| turn 事件流 | PiRpcDriver | SessionManager→daemon（既有管线） | AgentEvent v2（envelope） | 零新增——kind:agent_event 双轨既有 |
| 子进程非正常退出 | PiRpcDriver | SessionManager | onError | 会话级 fail（codex 同款） |

既有 create/claim/heartbeat/messages/complete 等事件：载荷与状态机**不变**。

## 8. 数据模型

**零 DDL**。caps 为代码级镜像表；pi 会话复用 AgentSession.agent_session_id（存 pi session id）。

## 9. 兼容策略（brownfield）

- claude/codex 零影响：改动集不含其任何文件；provider-registry 既有断言零回归。
- 未装 pi 的机器：daemon 探测不到 pi → 不注册 pi runtime → 前端 pi 不可选（既有 detector 行为，零新代码）。
- pi 不可用时会话创建失败路径：UnsupportedProviderError/runtime 不在线语义与 codex 同款。
- caps=false 项的 UI：附件/团队派工等按钮自动隐藏（查表裁剪，task-11 红利）；mcp false 不影响 pi 会话本身。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | rpc 协议细节与文档偏差（响应时序/streaming 状态判定） | P1 | 官方 rpc-client.ts 为参照实现；driver 测试用真实事件 fixture；执行期首任务跑 rpc 握手探针固化词表 |
| R-02 | subagent 为 examples/ 示例扩展（非内置，-e 需绝对路径，随 pi 版本漂移）且子代理消息聚合进 tool result details、无 per-child 归属 | P1 | caps.subagent 初始 false（§6.2 纪律）；实证任务：vendor 进 daemon 分发目录或解析包内 examples 路径 + 事件形状实测——归属可落则翻 true，否则如实留 false 并在 onboarding 案例锚记录（D-002） |
| R-03 | pi 事件流词汇随版本漂移 | P2 | 归一化器未知事件降级不丢；detector PROVIDER_SPECS.pi 补 minVersion '0.81.0'（档B 清单既有步骤，非与「detector 零改动」矛盾——本变更顺做） |
| R-04 | thinking 块形状与 Anthropic 不同（pi 自有格式） | P2 | 以 pi -p --mode json 实测输出为准写映射；golden fixture 锁定 |
| R-05 | Windows 下 pi spawn 路径解析（pi.cmd shim 实际存在于 nvm 目录） | P2 | 复用 resolveWindowsCmdShim（codex driver 先例）；stdio 编码对照既有 driver 经验 |

## 11. 决策追踪

- **D-001@v1**（RPC 长驻架构）：§5.1 全部。
- **D-002@v1**（桥接补齐+如实标记）：§5.3 能力矩阵三态结论、R-02。
- 无未解决的 D-xxx@vN。

## 12. 自审（Self-Review）

- ✅ 章节齐全；生命周期契约表已含（PI 映射表+既有事件不变声明）。
- ✅ 文件清单含数据流标注；改动面 = 2 新文件+3 caps+注册+测试+文档锚，四承诺区（SessionManager/daemon/backend/前端）零改动明示。
- ✅ UI 原型：跳过（provider 选择数据驱动无新 UI；分级依据=无布局/流程级变化）。
- ✅ 能力矩阵 8 项全有三态结论与依据；mcp/edit_patch/permission_dialog 如实 false + 替代/后续说明（D-002）。
- ✅ v2 对齐 Grill 六项：B-01 cli.ts 装配行入清单、B-02 前端白名单两处入清单（sessions/pre-session-picker + runtime-session-helpers）、B-03 session_started 改 get_state 合成、B-04 subagent 降示例扩展如实 false、B-05 接口对齐实契约+agent_settled 收敛+ui_request 自动取消、B-06 自洽。改动面全量=2 新文件+providers.ts+caps×3+cli.ts 装配行+前端白名单×2+agent-detector minVersion+测试+onboarding 案例锚（与 §6 清单一一对应）。
- ⚠️ 自审存疑 1（遗留）：rpc streaming 状态判定（何时 prompt 直发/何时需 steer）依赖 get_state 轮询或事件推断——执行期以 rpc-client.ts 参照实现定案。
