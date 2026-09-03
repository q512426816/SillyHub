---
author: qinyi
created_at: 2026-09-03 23:40:00
updated_at: 2026-09-03 23:59:00
scale: large
---

# 设计文档（Design）— 通用 Agent 接入抽象（AgentEvent 契约 + Provider 注册表）

> v2（2026-09-03）：按 Design Grill 审查（brainstorm-review-2026-09-03-232223）修订——B-01 partial/override 移植来源与 golden 锚修正、B-02 会话级消费面清单与 raw 契约修正、B-03 usage 实时透传语义修正、B-04 验收定义可测化；非阻塞项（zod 文件位置/文件清单笔误/cli.ts 遗漏/R-04 先例措辞）一并修正。修订记录见 §11。

## 1. 背景

SillyHub 目前真正可用的 agent 只有 Claude Code：daemon 交互式会话虽已有 `InteractiveDriver` 契约（claude/codex 两实现）与批量路径 6 协议 × 12 provider 注册表，但**事件归一化散落两处半**（批量 adapter.parse、交互式 backend `_extract_sdk_messages`、daemon stream_event 缓冲），`[ASSISTANT]/[TOOL_USE]` 文本协议是三端事实契约；SessionManager（6177 行）内大量 `provider === 'claude'` 分支；前端/后端散落硬编码 provider 门控。接入新 agent 时每个 provider 都要重写一遍归一化 hack，"便捷稳定接入"无从谈起。

对照 multica（github.com/multica-ai/multica，本地 `C:\Users\qinyi\IdeaProjects\multica`，23 agent CLI）调研结论：其滚雪球根基是**统一事件通道**（所有协议族 backend 吐同一种 7 型 Message）+ **声明式注册表**（能力差异用数据表 + 默认拒绝表达，不用接口方法）。本变更把这两个模式落到 SillyHub，实施路线为用户选定的**方案A 渐进下沉**（D-001@v1）：双轨兼容，验证稳定后旧文本协议退役（后续 change）。

## 2. 设计目标

1. **统一事件契约**：定义 provider 中性的 `AgentEvent`（v2，zod schema），交互式与批量两条链路共用一份 IR；归一化收敛到 daemon 侧 driver/adapter 内部，SDK/provider 类型不出 driver。
2. **Claude 零回归（可测定义）**：以真实 Claude 会话日志 fixture 双路径对照验收——**同一事件序列生成的两种载荷**（旧文本行 vs agent_event 行）分别过"旧文本协议解析"与"新 agent_event 结构化渲染"两条路径，断言 normalize 输出的渲染模型树等价（结构对比，忽略 log_id/timestamp 等非渲染字段）。深功能（子代理归属、Edit patch、partial 流式与 override 撤回、实时 usage、session/resume）不降级。
3. **provider 注册表**：daemon 交互式 provider 从 `'claude'|'codex'` 联合类型改为注册表驱动，新增 provider 不改类型系统。
4. **能力矩阵**：三端共享一张 provider 能力表（缺省 false 默认拒绝），收敛散落硬编码门控。
5. **接入清单**：产出新 provider 接入文档（三档路径），作为"便捷接入"的可执行交付物。

## 3. 非目标（Non-Goals）

- **不实际接入新 agent**（gemini/opencode 等）：各 CLI 交互式协议差异需独立调研，留后续 change 验证三档路径。
- **不弃用 Claude Agent SDK**：SDK 仍是 ClaudeSdkDriver 内部实现细节；直接 spawn `claude -p --stream-json` 列为后续可选优化。
- **不做数据库迁移**：`agent_run_logs` 已有所需结构化列，本变更零 DDL（见 §8）。
- **不退役旧文本协议**：`[ASSISTANT]` 文本行照常生成（作为兼容轨），退役是验证稳定后的后续 change。
- **不动批量路径的协议适配器实现**（adapters/*）：仅让批量 AgentEvent 类型与 v2 对齐（类型联合扩展），各 adapter 的 parse 逻辑不迁移。
- **不引入 execenv 式环境准备层**（multica 的每 provider HOME/配置隔离）：属后续 provider profile 工作，本变更仅在注册表描述符中预留字段位。

## 4. 拆分判断

单一连贯架构变更，不拆 MASTER：P1（事件契约）与 P2（注册表/能力矩阵）强耦合于同一抽象目标，分开会造成中间态更糟（先做注册表会放大"driver 伪造文本协议"问题，即被否决的方案C）。P1/P2 作为 plan 的 Wave 边界，各自独立可验收。无批量模式特征（非模板×数据）。

## 5. 总体方案

### 5.1 Phase 1 —— AgentEvent v2 事件契约（双轨）

```
现状（两套半归一化）                          目标（归一化下沉 daemon，双轨透传）
─────────────────────────                    ─────────────────────────────────────
ClaudeSdkDriver ─透传SDK原消息─┐              ClaudeSdkDriver
                               │               └─ claude-events.ts(新,有状态归一化器)
SessionManager._onMessage      │                 完整消息展开 ← 移植 backend _extract_sdk_messages
 (Anthropic形状解析:partial/   │                 partial缓冲/override ← 移植 session-manager
  segment/depth/bash/plan/     │                 depth状态机 ← 归一化器实例内维护
  task_notification/init)      │              CodexAppServerDriver
        ↓                      │               └─ codex flat msg → AgentEvent[]（映射表）
daemon.ts onTurnMessage ───────┤                ↓ SessionManager(瘦身:消费 status 事件,
        ↓ 原始dict             │                  seq 补号/usage lift/透传;raw 依赖清零)
backend _extract_sdk_messages  │                ↓ hub-client.submitMessages
 (只认Claude SDK形状) ─────────┘              messages:[{kind:'agent_event',
        ↓                                       event:{...}, dedup_key}]
AgentRunLog(文本行+结构化列)                    ↓
        ↓ SSE                                  backend submit_messages 新分支:
前端normalize.ts(文本协议解析)                  AgentEvent → 现有列 + metadata_.agent_event
                                              （旧 _extract_sdk_messages 保留=兼容轨）
                                               ↓ SSE(载荷新增 agent_event 字段)
                                              前端normalize.ts 双轨:
                                              有 agent_event → 结构化渲染；无 → 旧文本解析
```

关键设计点：

- **契约定义**（`sillyhub-daemon/src/types.ts` 类型扩展 + `sillyhub-daemon/src/agent-event-schema.ts` zod schema 新文件）：`AgentEvent` 类型联合从 5 型扩为 `text / thinking / tool_use / tool_result / status / error / turn_result / complete`（`complete` 为批量既有兼容别名，交互式统一用 `turn_result`）。一等可选字段 = 现交互式 flat record 顶层字段（parent_tool_use_id/subagent_type/depth 等，service.py:3702-3711）与 metadata 已知键（tool_name/call_id/session_id/usage 等）合并提升，见 §7。zod schema 独立新文件（types.ts 文件头自述"只导出 type/interface 不含运行时代码"，不得违背）。
- **Claude 归一化器**（`sillyhub-daemon/src/interactive/claude-events.ts` 新文件）：**有状态类** `ClaudeEventNormalizer`（实例化于 driver.start()，一轮会话一个实例），职责与移植来源三块：
  1. 完整消息展开（text/thinking block、tool_use/tool_result 配对、usage、session_id、子代理归属、Edit structuredPatch）——移植自 backend `_extract_sdk_messages`（run_sync/service.py:3446-3716；注意该函数对 stream_event 恒返回空，partial 不在其中）；
  2. partial 流式（stream_event content_block_delta 缓冲、节流 flush、segment_id 标记）与 override 撤回（`[ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE]` 等价语义）——移植自 daemon session-manager 现实现（session-manager.ts:5864-5988 flush 链、4723-4736 缓冲）；事件化表达见 §7（`is_partial + segment_id + override`）；
  3. depth 状态机（跨消息 subagentDepth 映射，现 session-manager.ts:4557-4866 内联维护）——归一化器实例字段维护（单消息纯函数无法产出 depth，故为有状态类）。
  不依赖 SDK 进程，可用真实消息样本做 golden 测试（验收锚见 §10 R-01）。
- **会话级信号事件化**（B-02 修正）：现 `_onMessage` 的 10+ 类会话级消费改为消费 provider 中性事件——`status` 型事件 + `subtype` 枚举承载：`session_started`（含 session_id；覆盖现 system/init→agentSessionId 提取与 codex thread_started）、`bash_chunk`、`bash_status`、`plan_mode`、`agent_task_status`、`task_notification`。**status 事件的路由分两路**（Grill 复核补充）：`bash_chunk/bash_status/plan_mode/agent_task_status/task_notification` 属瞬时会话 UI 信号，由 SessionManager 按 subtype 分发到**现有 onSessionEvent 独立通道**（WS/REST 既有链路，session-manager.ts:4880、cli.ts:781 接线，**不落 AgentRunLog、不经 submitMessages**），行为与现状一致；仅 `session_started` 随 submitMessages 上报用于 resume 指针 pin（backend 无行化处理，见 §7.5）。SessionManager 的对应分支改为按 subtype 分发（Bash 追踪、plan 状态、审批队列等会话语义保留，但输入从 raw SDK 形状改为中性事件）；异步回执（resume 等待）由 driver 内部持有。`system/task_*` 等纯 Claude 帧由归一化器吸收为 status 事件或静默丢弃，不再透传 raw。
- **Driver 契约演进**（`interactive/driver.ts`）：`onTurnMessage` 回调入参改为 `{ events: AgentEvent[] }`；`raw` 字段仅当环境变量 `SILLYHUB_DEBUG_RAW_EVENTS=1` 时携带（默认不携带），**下游（SessionManager/daemon.ts/cli.ts）禁止依赖 raw**——现 cli.ts:752-771 的 SDKMessage 类型接线随 P2 registry 演进为 AgentEvent。`InteractiveDriverResult` 增加结构化 usage/session_id。
- **usage 实时透传**（B-03 修正，对齐现行为）：**任意携带 usage 的事件**（含 partial text/thinking flush 事件，非仅 turn_result）→ daemon 层 lift（对齐现 daemon.ts:3564-3586）→ backend 更新 agent_runs token 统计并经 SSE summary 实时透传（对齐现 service.py:357-370 publish 链）。golden 测试覆盖该链路。
- **上报通道**（`hub-client.ts` submitMessages）：消息 dict 增加形态 `{"kind": "agent_event", "event": {...AgentEvent...}, "dedup_key": ...}`，与现有 dict 共存于同一 `messages` 数组（`LeaseMessagesRequest.messages` 本就是 `list[dict]` 无类型约束，schema.py:783-794，零接口破坏）。
- **backend 接收**（run_sync/service.py submit_messages）：识别 `kind=='agent_event'` → 新函数 `_persist_agent_event(ev)`：按现有行为生成同款文本行（`[TOOL_USE]` 前缀等，保证未升级前端渲染不断）+ 填充既有结构化列（tool_kind/parent 三列/segment_id/edit_patch）+ 完整事件 JSON 存 `metadata_['agent_event']`；usage 按上述实时语义更新 agent_runs；session_id 按 status session_started 事件更新 resume 指针（对齐现 service.py:1687-1707 守卫语义）；override=true 事件先按 (run_id, segment_id) DELETE 已落库 partial 再 INSERT（对齐现有 stale 撤回链）。无 `kind` 的消息走原 `_extract_sdk_messages` 路径（旧 daemon 兼容轨）。
- **SSE 透传**（publish payload）：run channel 与 session channel 的 log payload 增加可选 `agent_event` 字段（取自 `metadata_['agent_event']`；.get() 容错先例见 service.py:324-419）。
- **前端双轨**（`agent-log/normalize.ts`）：行对象带 `agent_event` → 直接由结构化事件构造渲染模型（不进文本正则）；否则走现有 `[ASSISTANT]` 文本协议解析（normalize.ts:112/560-564/593-600）。渲染输出以 §2 目标 2 的双路径 fixture 对照为验收判据。

### 5.2 Phase 2 —— Provider 注册表 + 能力矩阵

- **注册表**（`sillyhub-daemon/src/interactive/providers.ts` 新文件）：

  ```ts
  export interface ProviderDescriptor {
    provider: string;                 // detector key（'claude'|'codex'|...）
    family: ProtocolType;             // 复用 adapters 的 6 协议联合
    displayName: string;
    createDriver: (deps) => InteractiveDriver;
    caps: ProviderCaps;               // 能力矩阵单源（daemon 侧）
    envKeys?: Record<string, string>; // 预留：provider profile 环境键（本变更不实现注入）
    contextFile?: string;             // 预留：上下文文件约定（AGENTS.md/CLAUDE.md）
  }
  export const INTERACTIVE_PROVIDERS: Record<string, ProviderDescriptor> = { claude: {...}, codex: {...} };
  export type InteractiveProvider = keyof typeof INTERACTIVE_PROVIDERS;  // 从注册表推导
  ```

- **SessionManager 瘦身**（session-manager.ts）：`_getDriver` 改读注册表；`provider === 'claude'` 分支逐个下沉——systemPrompt preset 形状、partial 缓冲（P1 已移入归一化器）、多模态 blocks 转换 → 移入各 driver；`supportedDialogKinds`/审批桥差异 → driver 声明。P1 完成后 SessionManager 只消费中性事件（status 分发 + seq 补号 + usage lift + 透传），raw 依赖清零。
- **能力矩阵三端表**：`ProviderCaps = { resume, mcp, multimodal, thinking, subagent, permission_dialog, edit_patch, model_select }`（全 boolean，缺省 false）。daemon `providers.ts` 为单源；backend `app/modules/agent/provider_caps.py` 与 frontend `src/lib/provider-caps.ts` 手工镜像；对齐守护测试采用**源文件读取断言**（backend 测试直接读 daemon/frontend 的表源文件比对键值一致——现有 tool_kind 先例是双端共享用例复制，不含前端，本机制为其扩展）。前端 session-panel / backend daemon/session service 中散落的 `=== 'claude'` 门控改为查表。
- **接入清单**（`docs/agent-provider-onboarding.md` 新文件）：三档路径操作手册——①换 wrapper（注册表换 command，零代码）②族内新成员（descriptor 条目 + 差异微调）③新协议族（实现 driver + 归一化器 + 注册），含 multica 对照引用与 checklist。

## 6. 文件变更清单

主仓单仓变更（backend/frontend/sillyhub-daemon 均为主仓目录，不涉跨仓）。

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/types.ts | AgentEvent 类型联合扩展 + 一等可选字段（纯类型）。数据流：producer=driver 归一化器 → consumer=session-manager/submitMessages 序列化 |
| 新增 | sillyhub-daemon/src/agent-event-schema.ts | AgentEvent zod schema（types.ts 纯类型约束，运行时校验独立成文件） |
| 新增 | sillyhub-daemon/src/interactive/claude-events.ts | ClaudeEventNormalizer 有状态归一化器：完整消息展开（移植 backend _extract_sdk_messages）+ partial/override（移植 session-manager flush 链）+ depth 状态机。producer=SDK 消息流 → consumer=ClaudeSdkDriver.consume |
| 修改 | sillyhub-daemon/src/interactive/claude-sdk-driver.ts | consume 改用 ClaudeEventNormalizer；onTurnMessage 吐 events（raw 仅调试开关）；canUseTool/dialog 桥不动 |
| 修改 | sillyhub-daemon/src/interactive/codex-app-server-driver.ts | flat message → AgentEvent 映射（event_type→type 映射表；现 toFlatMessage 形状 driver.ts:33-35/426-435 已半具备） |
| 修改 | sillyhub-daemon/src/interactive/driver.ts | onTurnMessage 回调入参契约演进（events 数组 + 调试 raw）；InteractiveDriverResult 增结构化 usage/session_id |
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts | _onMessage 改消费中性事件（status subtype 分发承载现 bash/plan/task_notification/init 逻辑）；partial 缓冲/depth 移入归一化器；P2：_getDriver 改读注册表、claude 分支下沉 |
| 修改 | sillyhub-daemon/src/interactive/types.ts | CreateSessionInput/SessionManagerDeps 类型随 registry 演进 |
| 修改 | sillyhub-daemon/src/cli.ts | SDKMessage 类型接线（现 752-771 行消费 raw 形状）改为 AgentEvent 形态 |
| 新增 | sillyhub-daemon/src/interactive/providers.ts | Provider 注册表 + ProviderCaps 定义 + InteractiveProvider 推导 |
| 修改 | sillyhub-daemon/src/daemon.ts | onTurnMessage 接线：AgentEvent 包装为 kind:'agent_event' 消息经 submitMessages 上报；usage lift 链对齐 |
| 修改 | sillyhub-daemon/src/hub-client.ts | submitMessages 类型签名支持 agent_event 形态（运行时载荷不变，纯类型层） |
| 修改 | backend/app/modules/daemon/run_sync/service.py | submit_messages 新分支 _persist_agent_event（AgentEvent→现有列+metadata_；usage 实时更新；session pin；override 撤回）；SSE publish payload 增 agent_event 字段。数据流：producer=daemon submitMessages → 反序列化点=LeaseMessagesRequest(list[dict] 原样) → 映射点=_persist_agent_event 字段映射+文本行合成 → consumer=agent_run_logs 列/agent_runs 统计/Redis→SSE→前端 |
| 新增 | backend/app/modules/agent/provider_caps.py | 能力矩阵 Python 镜像表 + 查询函数；三端对齐测试锚点 |
| 修改 | backend/app/modules/daemon/session/service.py | 散落 `=== 'claude'` 门控改查 provider_caps（行为不变） |
| 新增 | frontend/src/lib/provider-caps.ts | 能力矩阵 TS 镜像表 |
| 修改 | frontend/src/components/agent-log/normalize.ts | 双轨：行带 agent_event → 结构化渲染模型；否则旧文本协议解析 |
| 修改 | frontend/src/components/daemon/session-panel.tsx | 附件/团队派工/resume/vision 门控改查 provider-caps（行为不变） |
| 新增 | docs/agent-provider-onboarding.md | 新 provider 接入清单（三档路径） |
| 新增 | backend/app/modules/agent/tests/test_provider_caps_alignment.py | caps 三端对齐守护测试（task-02） |
| 新增 | backend/app/modules/daemon/tests/test_run_sync_agent_events.py | agent_event 落库分支测试（task-07） |
| 新增 | backend/app/modules/daemon/tests/test_run_sync_golden_parity.py | golden 双载荷落库对照（task-12） |
| 新增 | backend/app/modules/daemon/tests/test_session_provider_caps.py | 门控行为不变断言（task-11） |
| 新增 | sillyhub-daemon/tests/agent-event-schema.test.ts | zod/类型一致性测试（task-01） |
| 新增 | sillyhub-daemon/tests/interactive/claude-events.test.ts | 归一化器 golden 用例（task-03） |
| 新增 | sillyhub-daemon/tests/interactive/golden/claude-events-golden.test.ts | 三源对照收口（task-12） |
| 新增 | sillyhub-daemon/tests/interactive/provider-registry.test.ts | 注册表测试（task-05） |
| 新增 | sillyhub-daemon/tests/daemon-agent-event-report.test.ts | 上报形态/legacy 开关测试（task-09） |
| 新增 | frontend/src/components/agent-log/__tests__/normalize-dual-path.test.ts | 双路径渲染等价判据（task-13） |
| 新增 | frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx | 前端门控行为不变断言（task-11） |

零 DB 迁移、零 OpenAPI schema 破坏（messages 本为 list[dict]）。

## 7. 接口定义

```ts
// sillyhub-daemon/src/types.ts（类型扩展；zod 校验见 agent-event-schema.ts）
export type AgentEventType =
  | 'text' | 'thinking' | 'tool_use' | 'tool_result'
  | 'status' | 'error' | 'turn_result' | 'complete'; // complete=批量兼容别名

export type AgentStatusSubtype =
  | 'session_started'      // 含 session_id；覆盖现 system/init→agentSessionId 与 codex thread_started
  | 'bash_chunk' | 'bash_status' | 'plan_mode' | 'agent_task_status' | 'task_notification';
// bash_chunk/bash_status 现为双事件（session-manager.ts:4815/4824），subtype 对齐现状

export interface AgentEventUsage {
  input_tokens?: number; output_tokens?: number;
  cache_read_tokens?: number; cache_creation_tokens?: number;
}

export interface AgentEvent {
  type: AgentEventType;
  content: string;                    // 空=无文本
  subtype?: AgentStatusSubtype;       // type='status' 时必填
  seq?: number;                       // turn 内单调递增（SessionManager 补号）
  tool_name?: string;                 // provider 原生工具名，不重命名（multica 原则）
  call_id?: string;                   // use/result 配对
  session_id?: string;                // provider 会话 id（resume；session_started 携带）
  usage?: AgentEventUsage;            // 任意型事件可携带（partial flush 实时透传，非仅 turn_result）
  parent_tool_use_id?: string;        // 子代理归属（Claude 深功能）
  subagent_type?: string;
  depth?: number;                     // 归一化器状态机产出
  segment_id?: string;                // partial 流式段标识
  is_partial?: boolean;               // true=流式半截行
  override?: boolean;                 // true=替换同 segment_id 已落库 partial（[ASSISTANT_OVERRIDE] 等价语义）
  edit_patch?: string;                // Edit structuredPatch JSON
  metadata?: Record<string, unknown>; // provider 长尾（model/effort/claude_code_version…）
}

// interactive/claude-events.ts（有状态归一化器骨架）
export class ClaudeEventNormalizer {
  constructor(opts: { onPartialFlush: (ev: AgentEvent) => void; flushIntervalMs: number });
  /** 一帧 SDK 消息 → 0..N 个完整事件（partial 经 onPartialFlush 节流吐出） */
  normalizeMessage(msg: SDKMessage): AgentEvent[];
  /** override 信号 → 撤回事件（override:true + segment_id + 完整内容） */
  normalizeOverrideSignal(...): AgentEvent;
  /** depth 状态机实例字段维护（跨消息） */
  private subagentDepth: Map<string, number>;
}

// interactive/driver.ts（契约演进）
export interface TurnMessageEnvelope {
  events: AgentEvent[];   // 归一化事件（一帧 SDK 消息可产 0..N 条）
  raw?: unknown;          // 仅 SILLYHUB_DEBUG_RAW_EVENTS=1 携带；下游禁止依赖
}
// onTurnMessage: (envelope: TurnMessageEnvelope) => void | Promise<void>
```

```python
# backend run_sync/service.py（新增分支，伪码）
if isinstance(msg, dict) and msg.get("kind") == "agent_event":
    ev = msg["event"]                       # AgentEvent dict
    if ev.get("override") and ev.get("segment_id"):
        # 对齐现有 stale 撤回链：先 DELETE (run_id, segment_id) 已落库 partial
        ...
    rows = self._persist_agent_event(run, lease, ev)
    # 行为对齐现路径：文本行合成（[TOOL_USE] 等前缀）+ 既有结构化列填充
    # + metadata_['agent_event']=ev
    # + ev.usage 非空 → agent_runs token 更新 + SSE summary 实时透传（不限 turn_result）
    # + ev.type='status' subtype='session_started' → resume 指针守卫更新
```

## 7.5 生命周期契约表

本变更命中 session/lease/agent_run/daemon 关键词，契约表如下（事件→任务映射由 plan 落实为代码+测试任务）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| submit message（新形态） | daemon（driver 归一化） | backend submit_lease_messages | kind='agent_event', event{type,content,seq?}, dedup_key? | append AgentRunLog 行（含 metadata_.agent_event） |
| submit message（旧形态） | 旧 daemon | backend submit_lease_messages | messages: list[dict]（无 kind 键） | 走 _extract_sdk_messages 兼容轨，行为与现状一致 |
| usage 实时更新 | daemon（任意携带 usage 的事件，含 partial flush） | backend | event.usage{input/output/cache_*} | agent_runs token 统计更新 + SSE summary 透传（对齐现链路） |
| override 撤回 | daemon（归一化器 override 信号） | backend | event{override:true, segment_id, content} | DELETE (run_id, segment_id) 已落库 partial → INSERT 完整行 |
| session pin（resume 指针） | daemon（status/session_started 事件） | backend | event{type:'status', subtype:'session_started', session_id} | agent_sessions.agent_session_id 守卫更新（对齐现 service.py:1687-1707）；**无行化**（不生成 AgentRunLog 行） |
| status 会话 UI 信号 | daemon SessionManager | 既有 onSessionEvent 通道（WS/REST） | subtype∈{bash_chunk,bash_status,plan_mode,agent_task_status,task_notification} | 不变（不落库、不经 submitMessages） |
| turn result | daemon | backend | event.type='turn_result', usage?, session_id? | agent_runs 终态统计；run 状态流转不变（close_interactive_run 既有链路） |
| SSE log（新字段） | backend publish | 前端 SSE | log payload 可选 agent_event 字段 | 无状态变化（渲染输入） |
| create/claim/heartbeat/interrupt 等既有事件 | — | — | 本变更不改其载荷与状态机 | 不变 |

## 8. 数据模型

**零 DDL**。`agent_run_logs` 既有列完全承载（model.py:465-583 实读核实）：channel/content_redacted（合成文本行）、tool_kind、parent_tool_use_id/subagent_type/depth、segment_id、edit_patch、dedup_key、`metadata_` JSON 列（新增键 `agent_event` 存完整事件；群聊投影键 member_id/source_carrier_run_id 等独立写入互不覆盖，经审查确认无冲突——投影行独立 INSERT 自带 metadata_，service.py:745-763）。`agent_runs` 既有统计列（usage/session_id）按 §7.5 语义更新。

## 9. 兼容策略（brownfield）

- **未升级前端 + 新 backend**：AgentEvent 落库仍合成同款文本行，旧前端渲染完全不受影响。
- **旧 daemon + 新 backend**：无 `kind` 键消息走原 `_extract_sdk_messages` 路径，行为与现状一致（经审查源码证实：无 event_type/content 的 dict 即进该函数，service.py:1039-1046）。
- **新 daemon + 旧 backend**（升级顺序错配窗口）：旧 backend 把 `kind:'agent_event'` 消息当普通 dict 交给 `_extract_sdk_messages`，因不含 Claude SDK 形状字段会被**静默丢弃**（审查证实推断成立）。对策：**部署顺序约定 backend 先于 daemon 升级**（本项目未上线、daemon 由平台分发，天然可控；文档写入 onboarding 与部署说明）。回退路径：daemon 侧配置开关 `SILLYHUB_LEGACY_TEXT_EVENTS=1` 强制走旧透传形态（默认关）。
- **能力门控行为不变**：P2 把 `=== 'claude'` 硬编码改为查表，表的 claude/codex 取值与现硬编码逐一相等（守护测试断言），纯重构无行为变化。
- 不改变的 API/表结构：`LeaseMessagesRequest`（本就 list[dict]）、所有既有端点签名、全部 alembic 迁移。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | Claude partial 流式/override 撤回下沉归一化器时语义漂移，前端流式渲染抖动 | P0 | golden 三源对照：真实 SDK 消息序列 fixture，断言 ClaudeEventNormalizer 输出 ≡ 现状三处实现联合语义（backend _extract_sdk_messages 完整展开行 + session-manager partial flush 行 + submit_messages 落库行）；Claude 会话手测清单（含 partial→override→撤回链路） |
| R-02 | SessionManager 6177 行大文件改动引入回归（会话级逻辑 10+ 类改 status 事件分发） | P0 | 分支下沉逐个进行（每分支独立 commit+测试）；status subtype 分发表与现 _onMessage 职责清单一一映射（plan 任务含对账表）；既有 session-manager 测试全绿为准入 |
| R-03 | 双轨期数据膨胀（文本行+结构化事件同存） | P1 | metadata_.agent_event 不重复存长文本（content 引用列值）；观察单轮日志量 |
| R-04 | 三端 caps 表漂移（daemon/backend/frontend 手工镜像） | P1 | 源文件读取断言式守护测试（backend 测试读 daemon/frontend 表源文件比对键值；tool_kind 双端共享用例先例的扩展） |
| R-05 | 升级顺序错配（新 daemon + 旧 backend 丢消息） | P1 | §9 部署顺序约定 + daemon 侧 legacy 开关回退 |
| R-06 | 交互式归一化下沉后 backend `_extract_sdk_messages` 仍在（两份逻辑并存期）语义分叉 | P1 | golden 测试同时锚定两份实现的输出一致性；退役（删除）列为后续 change 首项 |
| R-07 | 实时 usage/token 透传链路（partial 中途统计 + SSE summary）在新轨丢失 | P1 | §5.1 usage 实时语义明确"任意携带事件即更新"；golden fixture 覆盖 usage 断言；SSE summary 字段回归测试 |

## 11. 决策追踪

- **D-001@v1**（方案A 渐进下沉）：覆盖于 §5 全部设计（双轨机制）、§9 兼容策略、R-05/R-06。
- **D-002@v1**（会话级信号事件化：status subtype + 有状态归一化器 + raw 降格调试）：覆盖于 §5.1、§7、R-02。
- **D-003@v1**（usage 实时透传语义：任意携带事件即更新，非仅 turn_result）：覆盖于 §5.1、§7.5、R-07。
- **D-004@v1**（override 撤回事件化表达：override:true + segment_id）：覆盖于 §5.1、§7、§7.5、R-01。
- 无未解决的 D-xxx@vN。

## 12. 自审（Self-Review）

- ✅ 章节齐全（背景/目标/非目标/拆分/方案/清单/接口/生命周期/数据模型/兼容/风险/决策/自审）。
- ✅ 生命周期契约表：命中关键词，已含表（含 usage 实时/override 撤回/session pin 事件）；表中新形态事件将映射为 plan 任务（含测试任务）。
- ✅ 文件清单含数据流标注；v2 补 cli.ts 与 agent-event-schema.ts，修正操作列笔误。
- ✅ UI 原型：跳过（分级依据=无布局/结构/流程级界面变化，双轨渲染输出与现状等价，能力门控收敛不改行为）——已声明，非静默缺位。
- ✅ Claude 深功能不降级：AgentEvent 一等字段覆盖 subagent 归属/edit_patch/segment/usage/override（§7）。
- ✅ 零 DB 迁移主张核实（model.py:465-583 实读，Grill CC-05 证实）。
- ✅ v2 修订对齐 Grill：B-01（§5.1 归一化器三块移植来源 + R-01 三源对照锚 + override 事件化）、B-02（§5.1 会话级信号事件化 + §6 cli.ts + raw 降格）、B-03（§5.1/§7.5 usage 实时语义 + R-07）、B-04（§2 目标 2 双路径 fixture 可测定义）；CC-18（R-04 措辞）、CC-19（zod 独立文件）、CC-22（表格笔误）已修。
- ✅ 原"自审存疑 1"（codex 映射）经 Grill CC-08 证实映射基本现成（toFlatMessage 已半具备），风险低；原"自审存疑 2"（群聊 metadata 冲突）经 CC-20 证实无冲突，已关闭并入 §8。
