---
author: qinyi
created_at: 2026-10-15 13:25:24
generated_by: sillyspec-design-init
scale: "large"  # 规模评估（Step 8 落值）：真并行任务簇存在——task-01 探测 / task-06 backend 枚举 / task-07 前端选项与驱动核心线（task-02 信封层→task-03 事件→task-04 驱动→task-05 注册）互不依赖，可两路 Wave 分派；新增 6 源文件 + 3 测试文件约 2500 行（协议反推细节与事件 fixtures 密集），单上下文吞吐质量风险高；同 dsh 同型判例走 plan 路线
---

# 设计文档（Design）— 2026-10-15-zcode-engine-appserver

## 背景

平台现有交互式引擎三家（claude / codex / pi，外加批量层 cursor），用户希望在平台上像调用 claude code 一样调用 ZCode 进行单聊会话。ZCode 无 ACP profile、无官方集成 SDK（D-006 实证），但其 Desktop 内嵌引擎暴露 `app-server` 子命令——ZCode 私有协议的 stdio 服务端（NDJSON，信封 `{id, method, params}` strict 校验），与平台"spawn CLI 子进程当引擎"的既有模式同构（codex app-server 同为 stdio 自定义 JSON 协议）。接入模式照 codex app-server 自研驱动先例（D-005/D-007），不照 dsh 的 ACP 标准协议路径。

**协议事实（2026-10-15 实测，全部有据）**：无 initialize 握手，启动门为 `startup/storageState` 通知（phase=ready，~1.5s 含 DB 就绪）；`session/create` 与 `session/send` 各触发一道服务端→客户端请求 `session/requestRuntimePreferences`（15s 超时不应答则方法调用失败）；事件面含 token 级流式（`v4/telemetry/event` kind=stream.chunk，channel ∈ {text, thought}——thought 即思考流）、工具生命周期（tool_call / tool.lifecycle / tool_input_delta）、上下文用量（usage.delta）、turn 边界（turn.started / turn.terminal）；`state.updated` 通知携带完整模型目录（providerId/modelId/contextWindow/maxOutputTokens/reasoning levels）。本变更为 zcode 引擎接入的**阶段 1（仅单聊）**。

## 设计目标

1. `provider='zcode'` 成为新的交互引擎：单聊会话创建、token 级流式输出（消息/思考/工具生命周期）、打断、审批（manual_approval 代答）全链路可用；
2. 模型路由由平台 `LlmProvider` 接管：per-session 配置面（`ZCODE_DATA_BASE_DIR` 重定向 v2 目录）写 `provider_config.json` 个人 Provider（anthropic-messages / openai-chat-completions + baseUrl + apiKey + 模型清单），会话库接受机器共享（D-002）；无配置时回落机器默认已登录 Provider；
3. caps 十六键如实申报（thinking/compact/thinking_level/ctx_usage/token 流式均有协议通道支撑；mcp/attachments/steering/sessionFork 阶段 1 不开通），三端镜像（daemon 单源 → backend / frontend 生成物）自动刷新；
4. 与 dsh 变更（2026-10-15-dsh-engine-acp）**代码不重叠**：本变更不碰群附件门控（messages.py 归 dsh task-06）、不碰 dsh 任何交付文件的新增逻辑；共同修改文件（providers.ts / agent-detector.ts / version.ts / schema.py / session-list-panel.tsx）为各自增量条目，先后合入时顺序适配。

## 非目标

- 群聊成员接入 zcode（阶段 2）；
- `team_enabled`（派分身）对 zcode 开放（caps.subagent=false）；
- MCP 注入对接（caps.mcp=false——zcode 自有插件 MCP 体系，`session/create` 的 mcpServers 注入面未验证）；
- 附件链路（caps.attachments=false，同 codex 现状；协议图片内联面未验证）；
- steering 忙轮注入（caps.steering=false——运行中注入行为未验证，协议消息队列串行，排队语义生效）；
- 会话分叉（caps.sessionFork='none'——协议有 session/fork 但平台锚点语义未对接）；
- askuser 对话框桥（caps.dialog='none'——`interaction/requestUserInput` 阶段 1 自动取消应答，阶段 2 升级）；
- token 级流式之外的多模态块（caps.multimodal=false）；
- daemon 自动安装 ZCode Desktop（用户自装，D-001）；
- 批处理层接入（PROVIDER_TO_PROTOCOL 表不动）；
- 会话数据库隔离（D-002：接受机器共享，不深挖 DB 路径覆盖）。

## 拆分判断

单一内聚功能（一个新引擎的纵向切片：信封层 → 驱动 → 事件归一化 → 注册 → 后端枚举 → 前端选项），模块间强耦合于同一驱动契约，无可独立交付的平行子功能，不拆分；无批量模式特征。

## 总体方案

**Phase 1（daemon 探测与版本门）**：`agent-detector.ts` 注册新探测项（bin=zcode、envPath=SILLYHUB_ZCODE_PATH、versionPattern 匹配 `zcode <semver>`、minVersion=0.16.9）。探测 spec 扩展两个可选字段支撑 zcode 形态：`fallbackPaths: string[]`（env 与 PATH 均 miss 后的固定路径回退，含平台变量展开——Windows `%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`，macOS/Linux 按安装约定补充）与 `execNode: boolean`（目标是 .cjs 脚本时版本探测与 spawn 经 `process.execPath`）。`version.ts` MIN_VERSIONS 加 `zcode: (0,16,9)`（低于警告不硬拒，D-004）。二进制路径经现有 `_agentPaths` 流入驱动。

**Phase 2（信封层与驱动）**：新文件 `adapters/zcode-envelope.ts`——ZCode 私有协议 NDJSON 编解码器：出站请求 `{id, method, params?}` / 应答 `{id, result}` / 错误 `{id, error:{code,message,data?}}`（strict，多余键拒绝——实测 jsonrpc/requestId 键均被服务端拒）；自增数字 id 关联；服务端→客户端请求分发器（服务端请求 id 为字符串如 "server-1"，按 method 分派处理器，未注册方法回空 result）；入站按 union 四分支解复用（请求/通知/响应/错误）。新文件 `interactive/zcode-app-server-driver.ts` 实现 `InteractiveDriver` 契约：start（spawn `node <exePath> app-server --cwd <dir>`，env 注入 `ZCODE_DATA_BASE_DIR=<per-session>`，等 startup/storageState phase=ready，`session/create {workspace:{workspacePath, workspaceKey}}` 期间自动应答 `session/requestRuntimePreferences`（两道，默认值 askUserQuestionAutoResolutionEnabled=true / memoryEnabled=false / modelContextBudgetStrategy="preflight-v1" / nativeSearchEnhancementsEnabled=true）与 `interaction/requestOfficialMcpAuthHeaders`（回空））；consume（每轮 `session/send {sessionId, content}`，消费通知流经 zcode-events 归一化产出）；interrupt（`session/stop {sessionId}`）；可选 compact（`session/compact`）与 setThinkingLevel（`session/setThoughtLevel`）。`interaction/requestPermission` 桥接现有 `sessionPermission.requestPermission` 闭包：manual_approval 时走 PERMISSION_REQUEST 管线（allow → 回对应选项；deny/无注入/超时 → fail-closed reject），`!manualApproval` 时自动放行（对齐 codex `_handleApproval` 语义）；`interaction/requestUserInput` 回 cancelled（阶段 1）。握手/协议失败 → 结构化 error 事件 + 会话 failed（不重试不降级，D-004 兜底）。

**Phase 3（事件归一化与注册）**：新文件 `interactive/zcode-events.ts`——通知 → AgentEvent 归一化器：`v4/telemetry/event` kind=stream.chunk（channel=text → text 增量 / channel=thought → thinking 增量）、tool_call / tool.lifecycle（→ tool_use / tool_result 生命周期）、usage.delta（→ ctx_tokens 用量）、turn.started / turn.terminal（→ turn 边界与状态）；`computer-use/operation-event`（turn 边界校验源）；`state.updated`（模型目录缓存，供 setModel/前端模型选择）。`providers.ts` PROVIDER_CAPS 加 zcode 条目（十六键如实，见接口定义）；`INTERACTIVE_PROVIDERS` 加 ProviderAdapter：createDriver 工厂、fileSettings（per-session 配置面写入器 `zcode-settings.ts`）、perSessionDir（`zcode-home/<sessionId>`）、smokeSuite、switchable=true。模型路由：`zcode-settings.ts` 按 ProviderConfig 生成 `<per-session>/.zcode/v2/provider_config.json`（schemaVersion=1 + providerOrder + providerConfigRules 单条个人 Provider：api.type 按 base_url 形态判 anthropic-messages / openai-chat-completions、api.baseUrl、access.type="api-key"、access.apiKey、personalModelIds/modelOrder 含所选 model；密钥落文件不走 env 注入——D-003）；会话创建后 `session/setModel`，热切换（provider_config_changed）重写配置 + 重设 model。跑 `scripts/gen-provider-caps.mjs` 刷新三端镜像。

**Phase 4（backend 与前端）**：`schema.py` `InteractiveProviderLiteral` 加 `"zcode"`（schema 变更同变更内跑 `pnpm gen:types` + `pnpm -C sillyhub-daemon gen:types` 双义务，CLAUDE.md 规则 21）；前端 `session-list-panel.tsx` SESSION_ENGINE_OPTIONS 加 zcode 选项（群聊 ENGINE_OPTIONS 不动）。**不碰 `messages.py` 群附件门控**（dsh task-06 交付 caps 口径统一；zcode 阶段 1 无群聊，门控行为对 zcode 无影响）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:sillyhub-daemon/src/adapters/zcode-envelope.ts | ZCode 私有协议信封层：NDJSON 编解码（strict 四分支 union）+ 请求关联 + 服务端主动请求分发器（D-005/D-007） |
| 新增 | NEW:sillyhub-daemon/src/interactive/zcode-app-server-driver.ts | 驱动：spawn `node zcode.cjs app-server`、startup 就绪门、session/create-send-stop-close-setModel-setThoughtLevel-compact 方法面、requestPermission 代答桥、runtimePreferences/McpAuthHeaders 自动应答、握手失败结构化错误；实现 InteractiveDriver 契约 |
| 新增 | NEW:sillyhub-daemon/src/interactive/zcode-events.ts | 通知 → AgentEvent 归一化器：stream.chunk（text/thought 双通道）、tool_call/tool.lifecycle、usage.delta、turn 边界、state.updated 模型目录（照 pi-events.ts / claude-events.ts 先例） |
| 新增 | NEW:sillyhub-daemon/src/zcode-settings.ts | per-session 配置面写入器：`<dir>/.zcode/v2/provider_config.json` 个人 Provider 生成（anthropic-messages/openai-chat-completions + baseUrl + apiKey + 模型清单，照 codex-settings.ts 先例） |
| 新增 | NEW:sillyhub-daemon/tests/interactive/zcode-envelope.test.ts | 信封层单测：编解码往返、strict 拒多余键、服务端请求分发、id 关联 |
| 新增 | NEW:sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts | 驱动单测：就绪门/create-send 生命周期/权限代答三态/stop/握手失败结构化错误/thought-text 双通道流式 |
| 新增 | NEW:sillyhub-daemon/tests/interactive/zcode-events.test.ts | 归一化单测：实测事件序列样例钉映射（2026-10-15 抓包序列入库 fixtures） |
| 修改 | sillyhub-daemon/src/interactive/providers.ts | PROVIDER_CAPS 加 zcode 条目 + INTERACTIVE_PROVIDERS 加 ProviderAdapter（D-003/D-007） |
| 修改 | sillyhub-daemon/src/agent-detector.ts | 新增探测项：bin=zcode / SILLYHUB_ZCODE_PATH / fallbackPaths（Desktop 固定路径）/ execNode（.cjs 经 node 执行）（D-001）；AgentProviderSpec 扩展可选 fallbackPaths + execNode 字段 |
| 修改 | sillyhub-daemon/src/version.ts | MIN_VERSIONS 加 `zcode: (0,16,9)`（D-004 警告不硬拒） |
| 修改 | backend/app/modules/daemon/schema.py | InteractiveProviderLiteral 加 `"zcode"`。数据流：producer=backend Literal → FastAPI 校验/openapi → `pnpm gen:types` 重生成 frontend/src/lib/api-types.ts + `pnpm -C sillyhub-daemon gen:types` 重生成 sillyhub-daemon/src/api-types.ts（规则 21 双义务）→ consumer=会话创建表单 / daemon payload 校验 |
| 修改 | frontend/src/components/sessions/session-list-panel.tsx | SESSION_ENGINE_OPTIONS 加 zcode 选项（图标/标签） |
| 生成 | backend/app/modules/agent/provider_caps.py | gen-provider-caps.mjs 镜像刷新（生成物，随脚本产出） |
| 生成 | frontend/src/lib/provider-caps.ts | gen-provider-caps.mjs 镜像刷新（生成物，随脚本产出） |

## 接口定义

本变更 HTTP 接口面：0 端点（无接口变更，provider 枚举扩展经现有端点透传）。

**PROVIDER_CAPS zcode 条目**（16 键，全量如实申报，取值依据为 2026-10-15 协议实测）：
`resume=true`（session/resume）、`mcp=false`（注入面未验证，阶段 1 不开通）、`multimodal=false`（图片内联面未验证）、`attachments=false`（附件链路未开通，同 codex）、`thinking=true`（stream.chunk channel=thought）、`subagent=false`（平台分身管线不对接）、`permission_dialog=true`（interaction/requestPermission 桥）、`dialog='none'`（requestUserInput 阶段 1 自动取消）、`edit_patch=false`（structuredPatch 未验证）、`model_select=true`（setModel + state.updated 目录）、`provider_switch=true`（per-session provider_config 重写，switchable=true 单源）、`ctx_usage=true`（usage.delta）、`compact=true`（session/compact）、`thinking_level=true`（session/setThoughtLevel）、`steering=false`（运行中注入未验证）、`sessionFork='none'`（锚点语义未对接）

**驱动接口**（实现 `sillyhub-daemon/src/interactive/driver.ts:388-457` InteractiveDriver 契约）：
- `start(opts)`——spawn（`[process.execPath, exePath, 'app-server', '--cwd', cwd]`，exePath 来自 `_agentPaths.get('zcode')`；env `ZCODE_DATA_BASE_DIR` 指向 per-session 配置面）→ 等 `startup/storageState` phase=ready → `session/create {workspace:{workspacePath, workspaceKey}}`（期间分发器自动应答 runtimePreferences/McpAuthHeaders）→ 存 zcode sessionId → 按 provider_config `session/setModel`；
- `consume(input)`——每轮 `session/send {sessionId, content}`，通知流经 zcode-events 归一化产出 TurnMessageEnvelope；steering 不支持（caps.steering=false，排队语义上层处理）；
- `interrupt()`——`session/stop {sessionId}`；
- 可选 `compact()`——`session/compact {sessionId}`；`setThinkingLevel(level)`——`session/setThoughtLevel {sessionId, ...}`。

**ZCode 私有协议面**（2026-10-15 实测钉板）：
- 信封（strict zod，多余键拒绝）：请求 `{id, method, params?, trace?}` / 通知 `{method, params?, trace?}` / 响应 `{id, result}` / 错误 `{id, error:{code, message, data?}}`；客户端 id 数字自增，服务端请求 id 字符串（"server-N"）；
- client→server 方法：`session/create {workspace:{workspacePath, workspaceKey}}`、`session/send {sessionId, content}`、`session/stop {sessionId}`、`session/close {sessionId}`、`session/setModel`、`session/setThoughtLevel`、`session/compact`、`session/list`、`session/resume`；
- server→client 请求（分发器必答）：`session/requestRuntimePreferences`（create/send 各一道，15s 超时；应答 `{askUserQuestionAutoResolutionEnabled, memoryEnabled, modelContextBudgetStrategy:"preflight-v1", nativeSearchEnhancementsEnabled}`）、`interaction/requestPermission`（审批代答桥消费）、`interaction/requestUserInput`（阶段 1 回 cancelled）、`interaction/requestOfficialMcpAuthHeaders`（回空）；
- server→client 通知：`startup/storageState`（就绪门）、`state.updated`（模型目录/状态补丁）、`v4/telemetry/event`（kind ∈ stream.chunk（channel ∈ text/thought）/ tool_call / tool.lifecycle / tool_input_delta / usage.delta / turn.started / turn.terminal / model.request.status）、`computer-use/operation-event`（turn-started/turn-completed 边界）、`process/mcpTelemetry`。

## 生命周期契约表

本变更不新增生命周期事件，zcode 会话完全复用现有契约（新驱动作为既有事件的执行者接入）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| claim lease | daemon | backend | leaseId, claimToken, agentRunId | pending → running（不变，zcode 会话走同一 claim 管线） |
| create session | backend | daemon | sessionId, leaseId, claimToken, provider='zcode', provider_config | session active（daemon 侧 spawn app-server + 就绪门 + session/create + setModel） |
| submit message | daemon | backend | leaseId, claimToken, agentRunId | append messages（AgentRunLog 落库经现有管线，zcode-events 产出同构 AgentEvent） |
| turn result | daemon | backend | runId, status, output | running → completed/failed（turn.terminal 语义映射；握手/协议失败 → failed + 结构化 error） |
| permission request | daemon | backend | sessionId, PERMISSION_REQUEST payload | pending 审批行（requestPermission 代答桥 → 现有 permission_service 管线，回程 permission_response 控制指令不变） |
| session end | daemon | backend | sessionId, reason | active → ended（driver close → stdin EOF 优雅退出，超时清理阶梯照 codex；per-session 配置面目录随现有清理管线销毁；**zcode 会话库记录机器共享不随清理**——D-002） |

## 数据模型

无表结构变更。`AgentSession.provider` 为现有列的枚举扩展（Literal 加 `"zcode"`）；openapi 有 schema 透出 → 同变更内重生成 `frontend/src/lib/api-types.ts` 与 `sillyhub-daemon/src/api-types.ts`（规则 21 双义务）。caps 镜像为生成物。

## 兼容策略（brownfield 必填）

- **未安装 ZCode Desktop 的机器**：三段式探测全 miss → 引擎不可用（单聊入口不出现/禁用），现有引擎零影响；
- **未配置 LlmProvider 的 zcode 会话**：配置面不写 provider_config.json（不覆盖机器默认），zcode 用其本机默认已登录 Provider/账号（与 codex/pi 无配置先例一致）；
- **会话库机器共享（有意为之，D-002）**：平台 zcode 会话在 Desktop 会话列表互通可见；多 app-server 子进程并发读写共享 SQLite（Desktop + CLI 多进程共存为 ZCode 设计内行为，WAL）；平台侧会话清理不承诺清理 zcode 会话库残留；
- **Desktop 自动更新**：内嵌引擎路径/版本可能变化 → daemon 启动重扫 + 版本门警告（D-004）+ 协议失败结构化报错兜底；
- **与 dsh 变更共存**：共同修改文件（providers.ts / agent-detector.ts / version.ts / schema.py / session-list-panel.tsx / caps 镜像）均为各自增量条目，先后合入顺序适配；本变更不碰 messages.py（群附件门控统一归 dsh task-06）；
- **不改变的 API / 表结构**：无新端点、无迁移；现有引擎的驱动/注册条目零改动；
- **回退路径**：探测项/注册条目/枚举值均为增量，回退 = 删除注册（caps 镜像重生成即可恢复原状）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | ZCode 私有协议无公开 spec，0.16.x + Desktop 自动更新致协议破坏性变更 | P1 | D-004：MIN_VERSIONS (0,16,9) 警告 + 驱动握手/协议失败显式结构化错误（会话 failed），不重试不静默；单测钉实测事件序列防漂移 |
| R-02 | 会话库机器共享：多进程并发写 + Desktop 会话列表互通可见 | P1 | D-002 有意决策：Desktop+CLI 多进程共存为 ZCode 设计内行为（WAL）；共享语义写入本设计兼容策略与用户文档口径 |
| R-03 | Desktop 自动更新改变内嵌引擎路径/版本 | P1 | 探测每次 daemon 启动重扫（无路径缓存承诺）+ fallbackPaths 支持多版本路径并列 + 版本门警告 |
| R-04 | apiKey 明文落 per-session provider_config.json | P2 | 与 codex auth.json 同级安全姿势；per-session 目录随会话清理管线销毁；目录权限沿用现有 per-session 管线 |
| R-05 | stdin EOF 优雅退出行为未实测（ZCode app-server 对 stdin 关闭的反应） | P2 | 清理阶梯照 codex 先例兜底（EOF 宽限 → SIGTERM → SIGKILL）；verify 用例实测补充记录 |
| R-06 | requestUserInput 自动取消应答可能降低 agent 行为质量（AskUser 类工具收到 cancelled） | P2 | 阶段 1 已知限制记入非目标（dialog='none'）；阶段 2 升级为 dialog 桥 |
| R-07 | provider_config.json schema 随 ZCode 版本演进变化 | P2 | 写入器 schema 钉 schemaVersion=1 + 冒烟校验（smokeSuite 含配置生效断言）；失败结构化报错 |
| 无 UI 原型 | 原型分级=跳过：纯后端/daemon 逻辑 + 前端仅引擎下拉枚举追加（无布局/结构/流程变化，同 dsh 判例） | P2 | 用户已在 Step5 确认跳过 |

## 非功能生命周期

引入长驻子进程：zcode app-server 进程（每 zcode 会话一个）。自灭条件：①会话 end/interrupt 路径 driver close → stdin EOF（R-05 未实测，按设计预期优雅退出）；②清理阶梯：EOF 后宽限 → SIGTERM → SIGKILL（照 codex driver 清理先例）；③daemon 自身崩溃 → 子进程 stdin 管道断裂自动 EOF。per-session 配置面目录（zcode-home/<sessionId>）随现有 per-session 目录清理管线销毁；zcode 会话库（~/.zcode/cli/db）机器共享不随平台清理（D-002）。

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | Phase 1（agent-detector 探测项 + fallbackPaths/execNode 扩展）＋文件清单 agent-detector.ts 行 | 已覆盖 |
| D-002@v1 | Phase 3（perSessionDir 配置面隔离）＋生命周期契约表 session end 行＋兼容策略共享语义 | 已覆盖 |
| D-003@v1 | Phase 3（zcode-settings.ts provider_config.json 写入器 + setModel + 热切换）＋文件清单 NEW:zcode-settings.ts | 已覆盖 |
| D-004@v1 | Phase 1（MIN_VERSIONS zcode (0,16,9) 警告）＋Phase 2（握手失败结构化错误）＋R-01 | 已覆盖 |
| D-005@v1 | Phase 2（信封层 + 驱动方法面 + 服务端请求分发器）＋文件清单 NEW:zcode-envelope.ts / zcode-app-server-driver.ts | 已覆盖 |
| D-006@v1 | rejected 登记（等待官方 ACP/SDK 落选），非目标"无 ACP profile/SDK 依赖"背景 | 已覆盖（rejected） |
| D-007@v1 | Phase 2（独立信封层不动 adapters/json-rpc.ts；每会话一进程）＋文件清单 | 已覆盖 |

多裁定组合推演：D-001/D-002/D-003/D-004/D-005/D-007 相互独立（发现策略、隔离边界、路由方式、版本门语义、驱动实现、承载形态六轴无状态耦合——任意组合均无死锁格），无组合约束。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/非功能生命周期/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at；scale 留待 Step 8 规模评估落值）
- [x] 引用所有当前版本 D-001@v1 ~ D-007@v1
- [x] 涉及生命周期关键词 → 已含「生命周期契约表」（复用既有事件，无新增）
- [x] UI 原型分级核对：跳过（枚举微调，无布局/流程变化，同 dsh 判例），用户 Step5 已确认，理由记入风险登记表
- [x] 不确定问题标注：R-05（stdin EOF 行为未实测）为唯一实现期不确定点，降级为 verify 用例覆盖项；R-06/R-07 为已知限制带阶段 2 出路
