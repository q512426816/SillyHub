---
author: qinyi
created_at: 2026-09-04 03:04:41
---

# Agent Provider 接入手册（三档路径）

> 变更出处：`2026-09-03-agent-provider-abstraction`（task-14，FR-07 / D-001@v1）。
> 适用对象：向 SillyHub daemon 接入一个新的交互式 coding agent（或兼容 CLI wrapper）的工程师。
> 阅读前提：先读 design.md §5（总体方案）/ §7（AgentEvent 契约）/ §9（兼容策略）。
> 本文所有代码锚点以该变更合入后的代码现状为准（字段逐一实读核对，未实现的能力一律标注"预留未实现"）。

---

## 1. 总览：三件套架构

新 provider 接入围绕三件套展开，三者共同构成"便捷稳定接入"的基座：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ① AgentEvent v2 统一事件契约（provider 中性 IR）                            │
│                                                                             │
│    sillyhub-daemon/src/types.ts          （纯类型：8 型事件联合 + 一等字段）  │
│    sillyhub-daemon/src/agent-event-schema.ts  （zod 运行时校验              │
│                                              safeParseAgentEvent）          │
│    8 型：text / thinking / tool_use / tool_result /                         │
│         status / error / turn_result / complete（complete=批量兼容别名）    │
│    长尾信息一律进 metadata，顶层字段封闭                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                  ▲ 产出 / ▼ 消费
┌─────────────────────────────────────────────────────────────────────────────┐
│  ② Provider 注册表（interactive 唯一注册点）                                │
│                                                                             │
│    sillyhub-daemon/src/interactive/providers.ts                             │
│    INTERACTIVE_PROVIDERS: Record<string, ProviderDescriptor>                │
│      ├─ provider     detector key（与注册表键一致）                          │
│      ├─ family       ProtocolType（复用 adapters 6 协议联合）                │
│      ├─ displayName  展示名                                                 │
│      ├─ createDriver 工厂（零参构造，返回 InteractiveDriver）                │
│      └─ caps         引用 PROVIDER_CAPS 同名条目（capsOf 守卫）              │
│    envKeys? / contextFile? 为预留字段（未实现注入，见 §4/§5）                │
│    InteractiveProvider = keyof typeof INTERACTIVE_PROVIDERS（单源推导）      │
└─────────────────────────────────────────────────────────────────────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  ③ 能力矩阵 ProviderCaps（8 键全 boolean，缺省 false 默认拒绝）              │
│                                                                             │
│    单源：sillyhub-daemon/src/interactive/providers.ts       PROVIDER_CAPS   │
│    镜像：backend/app/modules/agent/provider_caps.py         PROVIDER_CAPS   │
│    镜像：frontend/src/lib/provider-caps.ts                  PROVIDER_CAPS   │
│    守护：backend/app/modules/agent/tests/                                   │
│          test_provider_caps_alignment.py（源文件读取断言）                   │
│    8 键：resume / mcp / multimodal / thinking / subagent /                  │
│          permission_dialog / edit_patch / model_select                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

**数据流一行图**（新轨全链路，接入新 provider 后自动获得）：

```
driver 归一化器（AgentEvent[]）
  → TurnMessageEnvelope{events, raw?}（interactive/driver.ts；raw 仅调试）
  → SessionManager（status subtype 分发到 onSessionEvent 独立通道；内容事件
     _eventToReportDict 平铺 + seq 补号，interactive/session-manager.ts）
  → daemon.ts onTurnMessage（识别事件轨 dict → 包装 {kind:'agent_event',
     event, dedup_key}；legacy 开关跳过包装）
  → hub-client submitMessages → backend submit_messages
     （kind=='agent_event' → _persist_agent_event：合成同款文本行 + 填既有
     结构化列 + metadata_['agent_event']；usage 实时更新；override 撤回）
  → SSE publish（log payload 可选 agent_event 字段）
  → 前端 normalize.ts 双轨（行带 agent_event → 结构化渲染；否则旧文本协议解析）
```

三档路径速查：

| 档 | 场景 | 代码成本 | 对应 multica 档位（§7） |
|---|---|---|---|
| A | 换 wrapper：同协议族兼容 CLI 顶替既有 provider 的二进制 | 零代码（env 覆盖） | custom runtime profile |
| B | 族内新成员：新增 provider 键，复用族 driver + 归一化器 | 一个 descriptor 条目 + 三端 caps 同步 | BuiltinRuntime 描述符 |
| C | 新协议族：全新交互协议，实现 driver + 归一化器 + 注册 | 一个实现 + 各注册点 | 新协议族 backend |

---

## 2. 接入前置认知

### 2.1 双轨兼容模型（旧文本协议冻结不扩展）

D-001@v1（渐进下沉）：daemon 侧 driver 归一化吐 AgentEvent（新轨），
backend 同步保留旧轨兼容——同一条事件既合成与现状同款的 `[ASSISTANT]` /
`[TOOL_USE]` 文本行（未升级前端渲染不断），又把完整事件 JSON 存进
`metadata_['agent_event']` 并经 SSE 可选 `agent_event` 字段透传（升级前端
走结构化渲染）。前端 `frontend/src/components/agent-log/normalize.ts` 双轨判据：
行对象带 `agent_event`（顶层字段或 `metadata_.agent_event`）→ 结构化渲染；
否则 → 旧文本协议解析。

**接入新 provider 时的纪律**：

- 旧文本协议（`[ASSISTANT]` 等前缀行）是兼容轨，**冻结不扩展**——不为新
  provider 在文本协议里加新前缀、新信号；新 provider 的信息一律走
  AgentEvent 一等字段 + `metadata` 长尾（zod 剥离顶层未知键，长尾必须进
  metadata，见 `sillyhub-daemon/src/agent-event-schema.ts` 文件头约定）。
- 新 provider 的事件产出必须过 `safeParseAgentEvent`（`sillyhub-daemon/src/agent-event-schema.ts`）
  校验；`type='status'` 必带 `subtype`（superRefine 强校验）。
- 调试 provider 原始消息：设 `SILLYHUB_DEBUG_RAW_EVENTS=1`，driver 才在
  `TurnMessageEnvelope.raw` 携带原始消息（默认不携带）。**下游
  （SessionManager / daemon.ts / cli.ts）禁止依赖 raw**——这是 D-002@v1 的
  raw 降格约定，新 driver 实现同样只许把 raw 当调试通道。

### 2.2 升级顺序约定与回退开关（design §9 / R-05）

daemon 由平台分发、backend 自管，两者版本可能短暂错配：

| 组合 | 行为 |
|---|---|
| 未升级前端 + 新 backend | 正常（文本行照常合成，旧前端渲染不受影响） |
| 旧 daemon + 新 backend | 正常（无 `kind` 键消息走原 `_extract_sdk_messages` 兼容轨） |
| **新 daemon + 旧 backend** | **丢消息**（旧 backend 把 `kind:'agent_event'` 当普通 dict 交给 `_extract_sdk_messages`，不含 SDK 形状字段被静默丢弃） |

因此约定：**部署升级顺序 backend 先于 daemon**。错配窗口期的本地回退：
daemon 侧设 `SILLYHUB_LEGACY_TEXT_EVENTS=1`，daemon.ts `onTurnMessage` 跳过
`kind:'agent_event'` 包装、事件轨 dict 原样透传（走 backend 旧兼容轨）。
开关只切上报形态，不影响本地计数/守卫；legacy flat dict（`[TASK_*]` 行 /
budget_exceeded / 旧 Codex flat）恒走旧透传，不受开关影响。

---

## 3. 档A：换 wrapper（零代码）

### 3.1 定位与成立条件

不新增 provider 键，用**同协议族的兼容 CLI** 顶替既有 provider 的二进制
（例：自建 claude 兼容网关 / 分发代理；GLM 等兼容端点的 CLI wrapper）。
与 multica 的 custom runtime profile（数据驱动 runtime_profile 表）不同，
SillyHub 现状无 runtime profile 表，零代码等价物是 **agent-detector 的
env 覆盖**：`sillyhub-daemon/src/agent-detector.ts` `resolveBinPath` 的解析
优先级为 `env 覆盖（文件存在才生效）→ PATH which → 不可用`。

成立条件（三条全满足才走档A，否则走档B）：

1. **同协议族逐面兼容**：
   - claude 位（`SILLYHUB_CLAUDE_PATH`）：wrapper 必须兼容 Claude Agent SDK
     的 spawn 契约——CLI 参数/flags、stream-json 输出帧（system/init、
     stream_event、assistant/result 等）、SDK 控制协议（canUseTool /
     mcpServers 会话内通道）。SDK 在 driver 内部（`interactive/claude-sdk-driver.ts`
     经 `pathToClaudeCodeExecutable` spawn），wrapper 差异会被 SDK 握手放大。
   - codex 位（`SILLYHUB_CODEX_PATH`）：wrapper 必须实现 codex app-server
     的 JSON-RPC 方法集（thread/turn 生命周期方法）。
2. **版本输出可解析**：`<wrapper> --version` 的 stdout+stderr 合并输出能被
   `PROVIDER_SPECS.<provider>.versionPattern` 捕获出版本号（claude 位正则
   兼容 `Claude Code X.Y.Z` 前后缀格式）。解析失败不阻断探测（status 仍
   available、version 记 undefined），但会失去 minVersion 门槛保护。
3. **路径合法**：env 指向的文件必须真实存在（`existsSync` 校验，失效自动
   降级 PATH 查找）；Windows 下注意 PATH 查找仅认 `.exe/.cmd/.bat/.ps1`
   后缀（不认 npm 的无扩展名 sh wrapper）。

### 3.2 操作 checklist

1. [ ] 安装/放置 wrapper 可执行文件，记下绝对路径。
2. [ ] 给 **daemon 进程环境**设置覆盖变量（重启 daemon 生效）：
   - claude 位：`SILLYHUB_CLAUDE_PATH=<wrapper 绝对路径>`
   - codex 位：`SILLYHUB_CODEX_PATH=<wrapper 绝对路径>`
   （变量名以 `agent-detector.ts` `PROVIDER_SPECS.<provider>.envPath` 为准，
   约定 `SILLYHUB_<大写PROVIDER>_PATH`。）
3. [ ] 查 daemon 启动日志的探测结果：该 provider `status='available'`、
   `path` 指向 wrapper；有 `versionWarning` 时核对 minVersion
   （claude 2.0.0 / codex 0.100.0）。
4. [ ] 冒烟：创建一个该 provider 的会话跑一轮对话，确认事件流 / usage
   统计 / 审批弹窗（若 wrapper 支持）行为正常（验收项见 §8）。

**边界提醒**：档A 顶替的是原 provider 的二进制——provider 键、caps、
displayName、事件契约全部不变。若需要"原 CLI 与新 wrapper **并存**为两个
provider"，那不是档A，走档B。

---

## 4. 档B：族内新成员（descriptor 条目）

### 4.1 定位与前置判断

新增一个 provider **键**，但其交互协议与既有族成员兼容（例：某个
Claude Code 兼容 fork、codex 兼容发行版），可直接复用族 driver +
归一化器，成本是一个注册表条目 + 三端 caps 同步。

前置判断：该 CLI 的输出帧与族内成员**逐帧同构**（claude 族 =
stream-json SDK 帧集；codex 族 = app-server JSON-RPC 方法集）。若帧格式
有实质差异（新增帧型/字段语义不同），微调归一化器属于"族内差异适配"
（见 4.3）；若差异大到需要独立状态机，那是档C。

### 4.2 操作 checklist（以新增 provider `xxx`、复用 claude 族为例）

1. [ ] **探测表**：`sillyhub-daemon/src/agent-detector.ts` `PROVIDER_SPECS`
   加条目（对照既有条目形状）：

   ```ts
   xxx: {
     bin: 'xxx',                                   // PATH 查找的可执行名
     envPath: 'SILLYHUB_XXX_PATH',                 // env 覆盖变量
     versionPattern: /(\d+\.\d+\.\d+)/,
     protocol: 'stream_json' as const,             // 族值
     minVersion: '...',                            // 可选（省略=无门槛）
   },
   ```

2. [ ] **caps 单源**：`sillyhub-daemon/src/interactive/providers.ts`
   `PROVIDER_CAPS` 加 `xxx` 条目（8 键全 boolean，逐键给取值依据的
   文件:行号锚点注释——照抄上方 claude/codex 注释块格式）。
   取值原则：**只描述已验证的真实能力，未验证一律 false**（见 §6）。

3. [ ] **注册表**：同文件 `INTERACTIVE_PROVIDERS` 加条目：

   ```ts
   xxx: {
     provider: 'xxx',
     family: 'stream_json',
     displayName: 'Xxx',
     createDriver: (): InteractiveDriver => new XxxDriver(),   // 见 4.3
     caps: capsOf('xxx'),                       // 引用单源，勿复制值
   },
   ```

   - `capsOf` 守卫会在模块加载时校验 `PROVIDER_CAPS.xxx` 存在（漏加立即抛错）。
   - `envKeys` / `contextFile` 为**预留未实现**字段（provider profile 层的
     环境键/上下文文件注入，design §3 非目标）——本档不填，不要误当可用能力。
   - 类型零改动：`InteractiveProvider` 联合由 `keyof typeof INTERACTIVE_PROVIDERS`
     自动扩展，`driver.ts` / `interactive/types.ts` / `session-manager.ts` 的
     provider 字段无需再改任何联合定义。

4. [ ] **driver 决策**：协议逐帧同构 → `createDriver` 直接指向族 driver 类
   （`new ClaudeSdkDriver()`）；有差异 → 薄封装子类（见 4.3 差异微调点）。

5. [ ] **批量层联动（必做）**：`sillyhub-daemon/src/adapters/index.ts`
   `PROTOCOL_PROVIDERS` 的对应协议数组加 `'xxx'`，并同步更新该文件的
   provider 计数断言（现值"期望 12（3+4+1+2+1+1）"→ 13）。原因：
   `tests/interactive/provider-registry.test.ts` 用例 3 断言注册表条目的
   `family === PROVIDER_TO_PROTOCOL[provider]`（interactive 与批量两层共享
   同一 provider→protocol 映射），新 provider 不进批量反查表则测试失败。

6. [ ] **backend 镜像**：`backend/app/modules/agent/provider_caps.py`
   `PROVIDER_CAPS` 加 `xxx` 字典（8 键取值与 daemon 单源逐键一致）。

7. [ ] **frontend 镜像**：`frontend/src/lib/provider-caps.ts` `PROVIDER_CAPS`
   加 `xxx` 对象（同上逐键一致）。

8. [ ] **测试同步**：
   - `sillyhub-daemon/tests/interactive/provider-registry.test.ts`：用例 1
     键集合断言（现 `'claude' | 'codex'`）与用例 5 `createDriver` 实例化
     断言补 `xxx`；用例 3 的"现值锚点"按需补一行。
   - 三端 caps 对齐守护 `backend/app/modules/agent/tests/test_provider_caps_alignment.py`
     **自动覆盖**新 provider（源文件读取断言：键集/provider 集/逐值相等/
     未知全 false），无需改断言，跑一遍确认三端同步即可。

9. [ ] **前端展示（建议）**：`frontend/src/lib/daemon.ts` `PROVIDER_META`
   加 `{ label, icon, color }`；有版本门槛则 `MIN_VERSIONS` 加条目。

10. [ ] **adapter id 对齐检查**：backend `AgentRun.agent_type`（adapter id，
    默认 `claude_code`）经 lease metadata 透传给 daemon 后由
    `agent-detector.ts` `normalizeProvider()` 归一化为 detector key。
    新 provider 的 adapter id 与 detector key **同名 → 零改动**；不同名
    （如 `claude_code`→`claude`）→ 在 `normalizeProvider` 加映射分支，
    否则 `_agentPaths.get(<adapter id>)` 不命中、interactive 静默早返回、
    lease 永远 claimed（历史坑 ql-20260703-001）。

11. [ ] 验证：跑本档相关测试 + 冒烟（§8）。

### 4.3 族内差异微调点（事件契约复用）

同族归一化器直接复用（claude 族 = `interactive/claude-events.ts`
`ClaudeEventNormalizer` 不动；codex 族 = codex driver 内 `toAgentEvent`
映射表不动）。常见差异只允许在 **driver / 归一化器入参**层适配：

- **stderr 嗅探**：codex 族 driver 把 stderr 行映射为 error 事件
  （`toAgentEvent` 映射表 #7，`interactive/codex-app-server-driver.ts`）；
  新成员 stderr 格式不同时在 driver 侧调嗅探正则，产物仍是标准 error 事件。
- **工具名映射**：`AgentEvent.tool_name` 保留 provider 原生工具名**不重命名**
  （multica 原则，design §7 注释）；工具分类（tool_kind）由归一化器经
  `classifyToolKind`（`sillyhub-daemon/src/tool-kind.ts`）处理，新成员工具
  集不同时在该处适配分类，不改事件契约。
- **模型发现**：**预留未实现**——SillyHub 现无模型枚举层（multica 的
  `agent/models.go` ListModels 对照），模型选择走
  `InteractiveDriverStartOptions.model` 覆盖（caps `model_select` 控制 UI
  是否开放）。后续若做模型发现，落点是各 driver 自身或 provider profile 层。

---

## 5. 档C：新协议族（完整接入）

### 5.1 定位

CLI 的交互式输出协议与现有两族（stream-json / app-server JSON-RPC）都
不兼容（例：ACP over stdio、私有 NDJSON 帧式）。需要实现
InteractiveDriver + 归一化器并完成全部注册点。参照实现二选一：

- **有状态归一化器模式**：`sillyhub-daemon/src/interactive/claude-events.ts`
  （`ClaudeEventNormalizer`——partial 缓冲/override 撤回/depth 状态机都需
  跨消息维护时用）。
- **无状态映射表模式**：`sillyhub-daemon/src/interactive/codex-app-server-driver.ts`
  的 `toAgentEvent`（event_type→type 映射表，帧自包含无跨帧状态时用）。

### 5.2 操作 checklist（每步含 design 锚点与代码锚点）

1. [ ] **协议调研（前置文档）**：摸清该 CLI 的帧格式全集、turn 生命周期、
   resume 机制（会话 id 语义）、审批/交互机制、usage 上报时机，产出
   "provider 帧 → AgentEvent"映射表（参照 codex driver 头注释的映射表
   格式，含 fail-safe 降级桶：未知帧型 → `status` + `subtype='task_notification'`
   降级 + `metadata.original_event_type` 保留原值，不丢弃不抛错）。

2. [ ] **归一化器**：新建 `sillyhub-daemon/src/interactive/<name>-events.ts`
   （design §5.1 "Claude 归一化器"同款职责边界）。硬性要求：
   - 每条产出必须过 `safeParseAgentEvent`（`sillyhub-daemon/src/agent-event-schema.ts`）
     ——顶层未知键会被 zod 剥离，长尾信息一律进 `metadata`；
   - 字段只能用 `types.ts` `AgentEvent` 现有一等字段：
     `type / content / subtype? / seq? / tool_name? / call_id? / session_id? /
     usage? / parent_tool_use_id? / subagent_type? / depth? / segment_id? /
     is_partial? / override? / edit_patch? / metadata?`——**不得发明新顶层字段**；
   - `type='status'` 必带 `subtype`，取值限 7 枚举：
     `session_started / bash_chunk / bash_status / plan_mode /
     agent_task_status / task_notification / thinking_tokens`（D-005@v1 含
     thinking_tokens）；无对应语义的会话信号自行吸收或静默丢弃，不透传 raw；
   - 协议若有流式半截输出：用 `is_partial + segment_id` 表达，完整到达用
     `override:true + segment_id + 完整内容` 撤回已落库 partial（D-004@v1）；
   - usage 五字段短名：`input_tokens / output_tokens / cache_read_tokens /
     cache_creation_tokens / ctx_tokens`（D-005@v1 含 ctx_tokens），任意型
     事件可携带（D-003@v1 实时语义）。

3. [ ] **driver**：新建 `sillyhub-daemon/src/interactive/<name>-driver.ts`，
   `implements InteractiveDriver`（契约全集见
   `sillyhub-daemon/src/interactive/driver.ts`，design §5.1/§7）：
   - `start(input: AsyncIterable<UserTurnInput>, options: InteractiveDriverStartOptions)`
     → 返回 `InteractiveDriverHandle`（`provider` 自填、与 driver 一致——E5
     interrupt 路由校验依赖；`processId?` 可观测；`close?()` 释放资源幂等）；
   - `consume(handle, callbacks)`：输出流逐帧经归一化器后**只走 envelope**
     调 `onTurnMessage({ events })`（envelope-only 收口，D-002@v1；`raw` 仅
     `SILLYHUB_DEBUG_RAW_EVENTS=1` 时携带）；turn 收敛调
     `onTurnResult(InteractiveDriverResult)`——`usage` 用五字段短名、
     `session_id` 结构化提升为一等字段（resume 消费）；异常经 `onTurnError`
     上报不得吞掉（E3）；`interrupt` no-op 返回 false 不冒泡（E3）；input
     队列只消费不 mutate/close（E4）；
   - `InteractiveDriverStartOptions` 的 provider 中性字段直接用：
     `cwd / resume? / model? / manualApproval? / askUserOnly? / env? /
     mcpServers?`；provider 专属启动字段定义本 driver 的扩展
     `StartOptions`（先例：claude 的 `pathToClaudeCodeExecutable`、codex 的
     `pathToAgentExecutable`，均经 `CreateSessionInput`
     `interactive/types.ts` 传入，值来自 daemon `_agentPaths`）。

4. [ ] **caps 单源**：`providers.ts` `PROVIDER_CAPS` 加条目（8 键 + 取值
   依据锚点注释，未验证能力一律 false——见 §6）。

5. [ ] **注册表**：同文件 `INTERACTIVE_PROVIDERS` 加条目
   （`provider/family/displayName/createDriver/caps: capsOf(<name>)`；
   `envKeys/contextFile` 预留未实现不填）。`family` 取值必须是
   `ProtocolType` 6 联合之一且与批量层反查一致（`PROVIDER_TO_PROTOCOL`）。

6. [ ] **探测表**：`agent-detector.ts` `PROVIDER_SPECS` 加条目（同档B 第
   1 步形状）。若新协议**超出 6 协议联合**：先扩
   `agent-detector.ts` `AgentProtocol` 与 `adapters/index.ts` `ProtocolType`
   双处联合，`PROTOCOL_PROVIDERS` 加新协议键（成员数组含 `<name>`），并
   更新 provider 计数断言——两处联合与计数断言是编译期/启动期强约束。

7. [ ] **批量层联动**：`adapters/index.ts` `PROTOCOL_PROVIDERS` 对应协议
   数组加 `<name>` + 计数断言同步（理由同档B 第 5 步；若暂不做该协议的
   批量 adapter，正向映射登记仍需加——守护测试只断言映射一致性，不要求
   `getBackend` 实现就位）。

8. [ ] **backend / frontend caps 镜像**：`backend/app/modules/agent/provider_caps.py`
   与 `frontend/src/lib/provider-caps.ts` 同步条目（三端逐键一致，守护
   测试自动覆盖）。

9. [ ] **前端展示**：`frontend/src/lib/daemon.ts` `PROVIDER_META` 加条目
   （+ `MIN_VERSIONS` 视需要）。session-panel / backend 的能力门控已查表，
   **无需为新 provider 改任何门控代码**——caps 表驱动。

10. [ ] **SessionManager / daemon 侧确认零改动**（这是抽象的收益，逐点核对）：
    - `_getDriver` 读 `INTERACTIVE_PROVIDERS` 注册表自动路由
      （`interactive/session-manager.ts`，未注册键抛 `UnsupportedProviderError`）；
    - exe 路径经 daemon `_agentPaths`（探测注册回填）→
      `CreateSessionInput` 传给 driver（`daemon.ts` create/reopen 链）；
    - 事件上报链（`_eventToReportDict` → `onTurnMessage` 包装 → backend
      `_persist_agent_event`）对任意 provider 中性，零改动；
    - `normalizeProvider` 映射检查（同档B 第 10 步）。

11. [ ] **测试**（design §10 风险对应的验收锚）：
    - 归一化器 golden：新建 `sillyhub-daemon/tests/interactive/<name>-events.test.ts`
      （参照 `tests/interactive/claude-events.test.ts`：真实消息样本 fixture
      进、AgentEvent[] 出、逐字段断言；partial/override/usage 链路必覆盖）；
    - driver 单测：参照 `tests/interactive/codex-app-server-driver.test.ts`
      （start/consume/interrupt/handle 生命周期 + envelope-only + E3/E5）；
    - 注册表测试更新：`tests/interactive/provider-registry.test.ts`
      （键集合/family 反查/实例化断言，同档B 第 8 步）；
    - caps 对齐：`backend/app/modules/agent/tests/test_provider_caps_alignment.py`
      自动覆盖。

12. [ ] 验收：typecheck + 上述测试 + 冒烟（§8）。

### 5.3 案例锚：PI（pi-coding-agent，2026-09-04）

> 档C 首个实战（2026-09-04-provider-pi-onboarding）。本小节先落 task-06 的
> **subagent 实证结论**；完整案例锚（§5.2 十二步勾选 + 冒烟对照 + 全部证据
> 摘要）见 task-07 补全。

#### subagent 实证结论（task-06 / R-02 / D-002@v1）

**caps.subagent 终值 = false（聚合型，per-child 归属不可落）。**

- **接入方式（模型侧可用，平台侧不可归属——两个独立命题）**：
  - pi 的 subagent 不是内置能力，是 `examples/extensions/subagent/` 示例扩展
    （`-e/--extension <路径>` 装载，pi CLI args.js:120-122）；
  - 已 vendor 进 `sillyhub-daemon/vendor/pi-extensions/subagent/`（pi 0.81.1
    快照；随 daemon 版本钉住防 pi 升级漂移），`scripts/build-bundle.sh` 会
    拷进 bundle（mcp-server.js 同级伴生文件先例）；
  - driver spawn 参数加 `--extension <vendored index.ts 绝对路径>`，运行时
    定位：env `SILLYHUB_PI_SUBAGENT_EXTENSION`（显式路径 / `off` 降级）→
    bundle 同目录 `vendor/` → dev `../../vendor/` 候选（见
    `pi-rpc-driver.ts` 的 `piVendoredSubagentExtensionPath`）；**版本脆弱性**
    ——扩展经 pi 的 jiti virtualModules 与已装 pi 的 ExtensionAPI 强耦合，
    pi 大版本升级可能装载失败，降级开关 env=off、缺文件静默跳过，刷新流程
    见 `vendor/pi-extensions/README.md`。
- **静态实读**（examples/extensions/subagent/index.ts）：
  - 子代理执行 = 每个 invocation spawn 独立子进程
    `pi --mode json -p --no-session [--model] [--tools] [--append-system-prompt <tmp>] "Task: ..."`；
  - 子进程 stdout 事件（`message_end` / `tool_result_end`）在扩展内解析并
    累积进 `SingleResult.messages`，**不进父事件流**；工具返回
    `details = {mode, agentScope, results[]}`（agent 名/exitCode/messages/
    usage/stopReason 聚合快照）。
- **动态实测**（2026-09-04 13:03，本机 pi 0.81.1 + 智谱 GLM；vendored 扩展
  + rpc 模式 + prompt 指定 `agent="linecounter"` 查 package.json 行数）：
  - 父事件流全程事件序列：`agent_start → message_update(thinking/toolcall) →
    tool_execution_start:subagent → tool_execution_update:subagent ×4 →
    tool_execution_end:subagent → … → agent_settled`；
  - **全流唯一 toolCallId** = 父的 subagent 调用（`call_b4d4…`）——子代理的
    read 工具调用与文本输出（4 条 messages：user / assistant(thinking+
    toolCall:read) / toolResult / assistant(text)）仅存在于
    `tool_execution_end.result.details.results[0].messages`；
  - `tool_execution_update.partialResult` 为 replace 语义累积快照（每次
    重带全量 results），子代理运行态只有 agent 名 + exitCode=-1 占位。
- **为何不翻 true**：前端团队派工/子代理树依赖 AgentEvent 的
  `parent_tool_use_id / subagent_type / depth` 归属三件套（claude-events.ts
  同款映射前提是子代理事件以独立事件进父流）；pi 的聚合快照要产出该形状
  需跨 update 差分合成的有状态机器，超出无状态归一化器「补映射」范畴
  （design §7 契约），且合成事件非真实协议事实——§6.2「先实现后翻 true」
  纪律下如实留 false。若未来 pi 原生提供 per-child 事件（或平台愿意接受
  合成归属），重跑本节实测步骤翻值即可。
- **复测步骤**（pi 升级后回归）：① 定义测试 agent（`~/.pi/agent/agents/
  <name>.md`，frontmatter `name/description/tools`，不 pin model 用默认
  provider）；② 起探针进程 `pi --mode rpc --session-dir <tmp> --extension
  <vendored>/index.ts`，发 prompt 指定 `agent="<name>"` 委派一个读文件任务；
  ③ 全量 stdout 行落文件，统计 distinct `toolCallId`（=1 即聚合型未变）并
  检查 `details.results[].messages` 形状。

---

## 6. 能力矩阵维护规范

### 6.1 改值流程（单源 → 两镜像 → 守护测试）

`ProviderCaps` 8 键：`resume / mcp / multimodal / thinking / subagent /
permission_dialog / edit_patch / model_select`（全 boolean）。

1. [ ] 改 **daemon 单源** `sillyhub-daemon/src/interactive/providers.ts`
   `PROVIDER_CAPS.<provider>.<key>` 取值，**同 commit 更新该条目上方
   docblock 的取值依据锚点**（文件:行号——现有 claude/codex 注释块即模板；
   锚点过期是文档债）；
2. [ ] 同步 **backend 镜像** `backend/app/modules/agent/provider_caps.py`
   `PROVIDER_CAPS`；
3. [ ] 同步 **frontend 镜像** `frontend/src/lib/provider-caps.ts` `PROVIDER_CAPS`；
4. [ ] 跑对齐守护测试：
   `pytest backend/app/modules/agent/tests/test_provider_caps_alignment.py`
   （4 用例：三端键集一致且为 8 契约键 / provider 集一致 / 逐 provider 逐键
   取值相等 / 未知 provider 返回全 false 且 8 键齐全）。

三端查询函数语义一致：daemon `getProviderCaps()` / backend
`get_provider_caps()` / frontend `getProviderCaps()`——已知 provider 返回
表内条目（daemon/frontend 返回共享对象**只读勿改**；backend 返回副本可改）。

### 6.2 默认拒绝语义

- **未知 provider 全 false，不抛错**：不在表内的 provider 查询得到 8 键
  全 false 的新对象——门控一律按"不支持"处理（FR-06 / D-002@v1）。新
  provider 忘记进 caps 表 → 所有能力门控静默关闭（会话能建但附件/团队/
  resume 等全禁），这是**故意的安全默认**，不是 bug。
- **先实现后翻 true**：caps 描述"当前真实能力"（取值须附硬编码门控/
  driver 实现的实读锚点），禁止为规划中的能力预翻 true。
- 三层防漂移（R-04）：
  1. daemon 侧 `capsOf` 模块加载守卫——注册表键缺 `PROVIDER_CAPS` 同名
     条目（或拼写漂移）立即抛错；
  2. `tests/interactive/provider-registry.test.ts` 用例 4——注册表条目
     `caps` 与单源**同引用**（`toBe`）且逐值相等、8 契约键齐全；
  3. backend 源文件读取断言——三端表源逐键比对，任一端漂移即测试失败。

---

## 7. multica 参照

三档路径模式的出处与完整对照见调研文档
`.sillyspec/changes/2026-09-03-agent-provider-abstraction/research-multica-agent-adaptation.md`：

- **§2.4 三档接入路径表**：档A custom runtime profile（零代码，flag 黑名单
  自动剥离）/ 档B BuiltinRuntime 描述符（omp 之于 pi）/ 档C 新协议族
  backend（约 9 处注册点，ACP 系薄封装几百行）——本手册三档划分的直接来源；
- **§6 multica 新增 agent 完整清单**：档C 在对方仓的 10 步清单（backend
  实现/白名单测试/DB CHECK 放宽/探测/env 准备/MCP/模型/前端），可作档C
  第 1 步协议调研的检查参照；
- **§4 结构性差异（不可照抄）**：multica 是任务制单发 `Backend.Execute`，
  SillyHub 是强交互会话制——保留 `InteractiveDriver` 双向契约与远程人审
  审批桥，**不复制 multica 代码，只借鉴模式与教训**。

借鉴要点一句话：**协议族归口 + 统一事件通道，能力差异用数据表 + 默认拒绝
表达（不往接口上加方法）**——multica 12 个 ACP agent 共享一份客户端实现
是其 23 agent 滚雪球的根本，SillyHub 以 AgentEvent v2 + 注册表 + caps 表
对齐该模式，并以双轨兼容（D-001@v1）降低切换风险。

---

## 8. 验收清单（新 provider 接入完成判定）

> 按仓库规则只跑与本次改动相关的测试，全量测试留给 CI（`.claude/CLAUDE.md`
> 核心规则 0）。

**静态检查**：

- [ ] `pnpm -C sillyhub-daemon typecheck`（InteractiveProvider 联合自动扩展、
  descriptor 类型错误在此暴露）；
- [ ] `pnpm -C frontend typecheck`（前端镜像表/PROVIDER_META 类型）。

**相关测试**：

- [ ] daemon：`pnpm -C sillyhub-daemon test -- tests/interactive/provider-registry.test.ts`
  + 新增的归一化器/driver 测试（档C）；档B 复用族归一化器时至少跑
  `tests/interactive/driver.test.ts` 确认契约不回归；
- [ ] backend：`pytest backend/app/modules/agent/tests/test_provider_caps_alignment.py`
  （三端 caps 对齐）；
- [ ] frontend：`pnpm -C frontend test -- src/components/agent-log`
  （normalize 双轨不回归）。

**冒烟（codex 接入同款验证路径）**：

1. [ ] daemon 启动，探测日志显示新 provider `available`（env 覆盖或 PATH），
   version/versionWarning 符合预期；
2. [ ] 前端创建该 provider 会话，跑一轮真实对话：
   - AgentRunLog 出现同款文本行（`[ASSISTANT]`/`[TOOL_USE]` 等，由 backend
     `_persist_agent_event` 合成）**且** `metadata_['agent_event']` 含完整
     事件 JSON（双轨落库）；
   - SSE log payload 带可选 `agent_event` 字段，前端结构化渲染正常
     （关掉该字段注入则回退旧文本解析，双轨互备）；
   - token 统计实时更新（轮中途 usage 即上报，不等 turn 结束）；
3. [ ] 按 caps 逐项验证翻 true 的能力：`resume`（断开重连/会话恢复）、
   `permission_dialog`（触发一次工具审批）、`multimodal`（带附件）、
   `interrupt`（打断进行中的 turn）；翻 false 的项确认 UI 正确隐藏/后端
   正确拒绝（默认拒绝语义生效）；
4. [ ]（涉及 daemon/backend 双端改动时）错配演练：旧 backend 环境下设
   `SILLYHUB_LEGACY_TEXT_EVENTS=1` 确认回退可用，事后关闭。

---

*本文由 task-14 产出；字段与代码现状核对记录见变更目录交付报告。后续
provider profile（envKeys/contextFile 注入）、旧文本协议退役为独立变更，
届时同步修订本文。*
