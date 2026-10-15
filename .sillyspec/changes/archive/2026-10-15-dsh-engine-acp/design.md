---
author: qinyi
created_at: 2026-10-15 12:26:54
generated_by: sillyspec-design-init
scale: large  # 规模评估（Step 8 精判）：用户显式要求完整五阶段流程（brainstorm→plan→execute→verify→archive，2026-10-15 对话指令）——复杂度轴如实记录：任务以顺序依赖为主（02/03 依赖驱动契约、04 依赖 03、05-07 依赖 04 的 caps 值、08 依赖全部），backend/frontend 三小任务可并行但单会话上下文可吞吐、无真 Wave 需求；按用户要求轴走 large 五阶段，plan 阶段 execution_mode 允许按实质回判 main
---

# 设计文档（Design）— 2026-10-15-dsh-engine-acp

## 背景

平台现有交互式引擎三家（claude / codex / pi，外加批量层 cursor），用户希望在平台上像调用 claude code、pi 一样调用 DeepSeek Harness（dsh）进行单聊会话。dsh 官方 ship 了 `--profile acp` stdio 接入面（Agent Client Protocol v1，Zed 同款标准协议，基于 NDJSON JSON-RPC），且 dsh 仓库自带参考客户端实现（`packages/subagent/subagent-acp`），与平台"spawn CLI 子进程当引擎"的既有模式（codex app-server 同为 stdio JSON-RPC）完全同构。本变更为 dsh 引擎接入的**阶段 1（仅单聊）**。

## 设计目标

1. `provider='dsh'` 成为第 4 个交互引擎：单聊会话创建、流式输出（已提交消息/思考/工具生命周期粒度）、打断、审批（manual_approval 代答）全链路可用；
2. 模型路由由平台 `LlmProvider` 接管：per-session 隔离 `DSH_HOME` 写 `cordis.patch.yml`（llm-pi-ai 自定义路由）+ 环境变量注入密钥；无配置时回落 dsh 本机默认模型；
3. caps 如实申报（无 compact / 无 steering / 无 token 级流式 / 无内联多模态块——dialog 走 'native' 审批桥，multimodal=false 见 R-08），三端镜像（daemon 单源 → backend / frontend 生成物）自动刷新；
4. 顺手清口径债：群消息附件门控从硬编码 `provider != "claude"` 统一为 caps 判定，与单聊口径对齐。

## 非目标

- 群聊成员接入 dsh（六要素白名单、影子会话触发）——阶段 2；
- `team_enabled`（派分身）对 dsh 开放（分身 mission_worker 注入仍是 claude-only，`sillyhub-daemon/src/cli.ts:1110-1113`）；
- compact 通道（ACP 无此方法，dsh 内部自管上下文，caps.compact=false 走现有 409 拒绝）；
- steering（忙轮中途注入；ACP 每会话一次一个 in-flight prompt，caps.steering=false，排队语义自动生效）；
- token 级流式（ACP 仅提交点通知，UI 无打字机效果，接受为已知限制）；
- daemon 自动安装 dsh（用户自装，D-001）；
- 不引入 `@agentclientprotocol/sdk` npm 依赖（D-004 rejected：协议层手写映射，复用 adapters/json-rpc.ts 基建）；
- 批处理层接入（`src/adapters/index.ts` PROVIDER_TO_PROTOCOL 6 协议表不动——本变更仅交互式管线）。

## 拆分判断

单一内聚功能（一个新引擎的纵向切片：驱动 → 注册 → 后端枚举 → 前端白名单），模块间强耦合于同一驱动契约，无可独立交付的平行子功能，不拆分；无批量模式特征（非"模板 × 数据"）。

## 总体方案

> 规模判定：scale=large（frontmatter 已落值）——依据为用户显式要求完整五阶段流程；复杂度轴无 Wave 证据（任务顺序依赖为主、单会话可吞吐），plan 阶段 execution_mode 可按实质回判 main。

**Phase 1（daemon 探测与版本门）**：`agent-detector.ts` 注册第 13 个探测项（bin=dsh、envPath=SILLYHUB_DSH_PATH、versionPattern 匹配 dsh `--version` 输出、minVersion=0.2.1、必填 `protocol` 字段='json_rpc'——AgentProtocol 六字面量之一）；`version.ts` MIN_VERSIONS 加 `dsh: [0, 2, 1]`（SemVerTuple 数组形态；低于警告不硬拒，D-002）。二进制路径经现有 `_agentPaths`（daemon.ts:3338 注册 → daemon.ts:8424 取用）自动流入驱动，Windows .cmd shim 复用 `resolveWindowsCmdShim`。

**Phase 2（ACP 驱动）**：新文件 `dsh-acp-driver.ts` 实现 `InteractiveDriver` 契约（start/consume/interrupt 必选；compact 不实现；getThinkingLevels/setThinkingLevel 经 `session/set_config_option` 的 reasoning_effort 可选实现）。协议帧复用 `adapters/json-rpc.ts`（codex 同款）。方法面：`initialize`（protocolVersion/capabilities 握手）→ `session/new`（新会话）或 `session/resume`（恢复会话——resume 选项非空时，caps.resume 的驱动落点）→ 每轮 `session/prompt` → `session/cancel`（interrupt）。通知面：`session/update`（assistant_message / message_part / thought / tool_call / tool_result 生命周期）由 `dsh-acp-events.ts` 归一化为 AgentEvent（text/thinking/tool_use/tool_result）。服务端请求 `session/request_permission` 桥接现有 `sessionPermission.requestPermission` 闭包：manual_approval 时走 PERMISSION_REQUEST 管线（allow → 回 ACP allow 选项；deny/无注入/超时 → fail-closed reject），`!manualApproval || askUserOnly` 时自动放行（对齐 codex `_handleApproval` 语义——ask_user_only 组合无需禁用，非用户输入类自动放行）。握手/协议失败 → 结构化 error 事件 + 会话 failed（D-002 兜底，不重试不降级）。

**Phase 3（注册与模型路由）**：`providers.ts` PROVIDER_CAPS 加 dsh 条目（16 键如实申报，见接口定义）；`INTERACTIVE_PROVIDERS` 加 ProviderAdapter：createDriver 工厂、envInjector（apiKeyEnv 密钥注入）、fileSettings（per-session DSH_HOME patch 写入器 `dsh-settings.ts`，照 `codex-settings.ts` / `pi-settings.ts` 先例）、perSessionDir（`dsh-home/<sessionId>`）、smokeSuite、switchable=true。模型路由：按 `ProviderConfig`（base_url/api_key/model）生成 `DSH_HOME/profiles/acp/cordis.patch.yml`——llm-pi-ai 自定义 provider（api 按 base_url 形态判 anthropic-messages 或 openai-completions；apiKeyEnv 指向注入的密钥变量名）；会话创建经 `session/set_config_option` 设初始 model，热切换（provider_config_changed）重写 patch + 重设 model。跑 `scripts/gen-provider-caps.mjs` 刷新 backend / frontend 镜像。

**Phase 4（backend 与前端）**：`schema.py:129` `InteractiveProviderLiteral` 加 `"dsh"`（schema 变更同变更内跑 `pnpm gen:types` + daemon 侧 `gen:types`，CLAUDE.md 规则 21）；`messages.py:791-797` 群附件门控改 `get_provider_caps(provider)["attachments"]` 判定；前端 `session-list-panel.tsx` SESSION_ENGINE_OPTIONS 加 dsh 选项（群聊 ENGINE_OPTIONS / GROUP_SUPPORTED_PROVIDERS 不动）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:sillyhub-daemon/src/interactive/dsh-acp-driver.ts | ACP v1 驱动：spawn `dsh --profile acp`，initialize/session 方法面 + request_permission 代答桥 + session/cancel；实现 InteractiveDriver 契约 |
| 新增 | NEW:sillyhub-daemon/src/interactive/dsh-acp-events.ts | session/update 通知 → AgentEvent 归一化器（照 pi-events.ts / claude-events.ts 先例） |
| 新增 | NEW:sillyhub-daemon/src/dsh-settings.ts | per-session DSH_HOME 的 cordis.patch.yml 写入器（llm-pi-ai 路由生成，照 codex-settings.ts 先例） |
| 新增 | NEW:sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts | 驱动单测：握手/事件映射/权限代答三态/cancel/握手失败结构化错误 |
| 新增 | NEW:sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts | 归一化单测：ACP spec 样例事件序列钉映射 |
| 新增 | NEW:backend/app/modules/daemon/tests/test_group_attachment_gate.py | 群附件门控 caps 口径测试（claude/pi/cursor/dsh 放行、codex/未知引擎拒绝） |
| 修改 | sillyhub-daemon/src/interactive/providers.ts | PROVIDER_CAPS 加 dsh 条目 + INTERACTIVE_PROVIDERS 加 ProviderAdapter（D-003） |
| 修改 | sillyhub-daemon/src/agent-detector.ts | 第 13 个探测项：bin=dsh / envPath=SILLYHUB_DSH_PATH / versionPattern / minVersion=0.2.1（D-001） |
| 修改 | sillyhub-daemon/src/version.ts | MIN_VERSIONS 加 `dsh: [0, 2, 1]`（D-002 警告不硬拒） |
| 修改 | backend/app/modules/daemon/schema.py | InteractiveProviderLiteral 加 `"dsh"`。数据流：producer=backend Literal（schema.py:129）→ FastAPI 校验/openapi → `pnpm gen:types` 重生成 frontend/src/lib/api-types.ts + `pnpm -C sillyhub-daemon gen:types` 重生成 sillyhub-daemon/src/api-types.ts（CLAUDE.md 规则 21 双义务）→ consumer=会话创建表单 / daemon payload 校验 |
| 修改 | backend/app/modules/daemon/group/service/messages.py | 群附件门控发送侧（:791-797）从 `provider != "claude"` 硬编码改为 `get_provider_caps(provider)["attachments"]` 判定，与单聊 attachments.py:59 口径对齐 |
| 修改 | backend/app/modules/daemon/group/service/shadow.py | 群附件门控触发侧（:266-273，非 Claude 成员带附件触发 400）同款统一为 caps 判定——两处同口径，防"发送放行、触发被拒"半兑现（plan 审查 gap 修正） |
| 修改 | frontend/src/components/sessions/session-list-panel.tsx | SESSION_ENGINE_OPTIONS 加 dsh 选项（图标/标签） |
| 修改 | frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx | 单聊引擎下拉含 dsh、群聊白名单不含 dsh 的断言 |
| 新增 | NEW:sillyhub-daemon/tests/interactive/dsh-acp-smoke.test.ts | 端到端冒烟（skipIf 无 dsh/低版本守护，显式留痕不假绿） |
| 生成 | frontend/src/lib/api-types.ts | pnpm gen:types 再生成（schema 枚举透出，规则 21 义务） |
| 生成 | sillyhub-daemon/src/api-types.ts | pnpm -C sillyhub-daemon gen:types 再生成（规则 21 双义务） |
| 生成 | backend/app/modules/agent/provider_caps.py | gen-provider-caps.mjs 镜像刷新（生成物，随脚本产出） |
| 生成 | frontend/src/lib/provider-caps.ts | gen-provider-caps.mjs 镜像刷新（生成物，随脚本产出） |
| 修改 | sillyhub-daemon/scripts/gen-provider-caps.mjs | ENGINES 五引擎（dsh 增补后解析守卫同步） |
| 修改 | sillyhub-daemon/src/interactive/session-manager/driver-factory.ts | sessionPermission 注入条件加 dsh（6 行接线——D-006 执行期边界裁决补录） |
| 修改 | backend/app/modules/daemon/group/service/helpers.py | group_attachment_gate_denied 共享判定助手（task-06 两处门控同源，plan 审查 gap 修正补录） |
| 修改 | frontend/src/lib/daemon/runtimes.ts | SESSION_SUPPORTED_PROVIDERS/PROVIDER_META 加 dsh（真单一源——D-007 执行期边界修正补录） |
| 修改 | frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx | provider-caps 形状钉子闸连带（dsh 十六键前置事实钉） |

## 接口定义

本变更 HTTP 接口面：0 端点（无接口变更，provider 枚举扩展经现有端点透传）。

**PROVIDER_CAPS dsh 条目**（16 键，全量如实申报；Grill 修正后口径）：
`resume=true, mcp=true, multimodal=false, attachments=true, thinking=true, subagent=false, permission_dialog=true, edit_patch=false, model_select=true, provider_switch=true, ctx_usage=true, compact=false, thinking_level=true, steering=false, dialog='native', sessionFork='none'`

caps 口径修正依据（Design Grill 阻断项修复，2026-10-15）：
- `permission_dialog=true / dialog='native'`：本仓 `dialog='native'` 定义即"permission_dialog 桥，pending 行 + 答题端点"（sillyhub-daemon/src/interactive/providers.ts:100-107），与 ACP `session/request_permission` 代答桥机制完全同构，codex 同机制申报 `true/'native'`——原设计误按"无 elicitation"申报 none 已纠正；
- `multimodal=false`：dsh ACP 的图片输入有条件性（"image prompts only when the durable attachment store and configured exact route support them"，dsh 仓库 packages/acp/acp/README.md:64/:173），保守降级走平台引擎中立的 disk 落盘链路收附件（cursor 先例：multimodal 无关，attachments=true 即收，图片/PDF 经 D-9 gate 降级为文件路径清单）；复升条件见 R-08。

**驱动接口**（实现 `sillyhub-daemon/src/interactive/driver.ts:388-457` InteractiveDriver）：
- `start(opts: InteractiveDriverStartOptions): Promise<void>`——spawn（exePath 来自 `_agentPaths.get('dsh')`，Windows shim 解析）→ `initialize` → `session/new`（新会话，cwd）或 `session/resume`（opts.resume 非空时，caps.resume 落点）→ 按 provider_config 经 `session/set_config_option` 设 model；
- `consume(input: AsyncIterable<UserTurnInput>): AsyncIterable<TurnMessageEnvelope>`——每轮 `session/prompt`，消费 `session/update` 通知流（经 dsh-acp-events 归一化）产出事件；忙轮不支持 steering（caps.steering=false，排队由上层语义处理）；
- `interrupt(): Promise<void>`——`session/cancel {sessionId}`；
- 可选 `setThinkingLevel(level)`——`session/set_config_option {reasoning_effort}`；`getThinkingLevels()` 静态档位表（ACP 侧为 low/medium/high，经 mapPlatformLevelToEngine 映射）。

**ACP 协议面**（v1，NDJSON JSON-RPC over stdio）：
- client→server：`initialize` / `session/new` / `session/resume` / `session/prompt` / `session/cancel` / `session/set_config_option`；
- server→client 通知：`session/update`（update.sessionUpdate ∈ {agent_message_chunk→committed 粒度, agent_thought_chunk, tool_call, tool_call_update, context_usage}——按 dsh `packages/acp/acp/README.md` 能力矩阵实现；plans/modes 为 ACP 明示 unsupported，不在列）；
- server→client 请求：`session/request_permission`（options[] + 更新列表，代答桥消费）。

## 生命周期契约表

本变更不新增生命周期事件，dsh 会话完全复用现有契约（新驱动作为既有事件的执行者接入）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| claim lease | daemon | backend | leaseId, claimToken, agentRunId | pending → running（不变，dsh 会话走同一 claim 管线） |
| create session | backend | daemon | sessionId, leaseId, claimToken, provider='dsh', provider_config | session active（daemon 侧 spawn dsh 子进程 + initialize + session/new） |
| submit message | daemon | backend | leaseId, claimToken, agentRunId | append messages（AgentRunLog 落库经现有 event-wire/eventToSubmitMessages，dsh-acp-events 产出同构 AgentEvent） |
| turn result | daemon | backend | runId, status, output | running → completed/failed（session/update turn 结束语义映射；握手/协议失败 → failed + 结构化 error） |
| permission request | daemon | backend | sessionId, PERMISSION_REQUEST payload | pending 审批行（request_permission 代答桥 → 现有 permission_service 管线，回程 permission_response 控制指令不变） |
| session end | daemon | backend | sessionId, reason | active → ended（driver close → dsh 子进程退出（stdin EOF 优雅退出，超时强杀照 codex 清理阶梯）；per-session DSH_HOME 目录随现有会话清理策略） |

## 数据模型

无表结构变更。`AgentSession.provider` 为现有列的枚举扩展（Literal 加 `"dsh"`）；openapi 有 schema 透出 → 同变更内重生成 `frontend/src/lib/api-types.ts` 与 `sillyhub-daemon/src/api-types.ts`（规则 21 双义务）。caps 镜像为生成物。

## 兼容策略（brownfield 必填）

- **未安装 dsh 的机器**：探测不到 → 引擎不可用（单聊入口不出现/禁用），现有三引擎零影响；
- **未配置 LlmProvider 的 dsh 会话**：不写 patch、不注 env，dsh 用其本机默认模型（与 codex/pi 无配置先例一致；建会话 warnings 提示管线已覆盖）；
- **caps 口径统一的行为变化（有意为之）**：群附件门控从"仅 claude"变为 caps.attachments 判定后，**pi 与 cursor 的群附件从拒绝变为放行**（二者单聊本就放行——pi 附件链路 ql-20260921-005、cursor 落盘 disk 交付，群聊硬编码是不一致债）；codex（attachments=false）与未知引擎维持拒绝；dsh 随 caps=true 放行。测试逐引擎钉住；
- **不改变的 API / 表结构**：无新端点、无迁移；现有引擎的驱动/注册条目零改动；
- **回退路径**：探测项/注册条目/枚举值均为增量，回退 = 删除注册（caps 镜像重生成即可恢复原状）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | dsh 0.2.x alpha 破坏性变更致协议不兼容 | P1 | D-002：MIN_VERSIONS [0, 2, 1] 警告 + 驱动握手/协议失败显式结构化错误（会话 failed），不重试不静默 |
| R-02 | ACP 无 token 级流式，UI 打字机效果降级 | P2 | 已知限制记入非目标；前端流式光标对 dsh 显示提交粒度（不新做轮询） |
| R-03 | 群附件口径统一使 pi/cursor 行为变化 | P1 | 设计已确认为对齐单聊的有意变化；**发送侧（messages.py:791-797）与触发侧（shadow.py:266-273）两处门控同口径统一**（只改一侧会半兑现——plan 审查 gap 修正）；test_group_attachment_gate.py 两侧×逐引擎断言（claude/pi/cursor/dsh 放行，codex/未知拒） |
| R-04 | Windows 下 dsh 为 .cmd shim，spawn 直接 exec 失败 | P1 | 复用 resolveWindowsCmdShim（codex 同款，codex-app-server-driver.ts:869 先例） |
| R-05 | per-session DSH_HOME patch 写入与 dsh 配置 HMR 的时序（写入后未生效即 prompt） | P2 | patch 写入完成后再 spawn（fileSettings 先于 driver start 的现有顺序）；热切换重写 patch 后下一次 set_config_option 前留 HMR 生效间隙，verify 用例覆盖 |
| R-06 | dsh 子进程残留（daemon 崩溃后） | P2 | stdin EOF 优雅退出 + 清理阶梯照 codex；非功能生命周期见下节 |
| R-07 | caps 申报失真（dsh alpha 演进 vs 静态申报漂移，三端镜像固化误报） | P1 | 版本门警告（D-002）+ smokeSuite 冒烟钉真实能力 + caps 镜像快照测试；Grill 已按 dsh README 逐键对照修正一轮 |
| R-08 | multimodal=false 降级取舍——dsh ACP 图片输入依赖 durable attachment store + exact route（README:64/:173） | P2 | 附件走平台 disk 落盘链路（cursor 先例，模型不直接看图）；复升条件：dsh 侧 attachment store/exact route 配置成熟且冒烟验证通过后升 multimodal=true 走内联块 |
| 无 UI 原型 | 原型分级=跳过：纯后端/daemon 逻辑 + 前端仅引擎下拉枚举追加（无布局/结构/流程变化） | P2 | 用户已在 Step5 确认跳过 |

## 非功能生命周期

引入长驻子进程：dsh 进程（每 dsh 会话一个）。自灭条件：①会话 end/interrupt 路径 driver close → stdin EOF，dsh 按 ACP profile 设计优雅退出（stdin EOF 即退出）；②清理阶梯：EOF 后宽限 → SIGTERM → SIGKILL（照 codex driver 清理先例）；③daemon 自身崩溃 → 子进程 stdin 管道断裂自动 EOF 退出（ACP profile 语义保证，不依赖 spawn 侧环境变量）。per-session DSH_HOME 目录随现有 per-session 目录清理策略（与 CODEX_HOME/PI_CODING_AGENT_DIR 同一管线）。

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | Phase 1（agent-detector 第 13 项）＋文件清单 agent-detector.ts 行 | 已覆盖 |
| D-002@v1 | Phase 1（MIN_VERSIONS dsh [0, 2, 1] 警告）＋Phase 2（握手失败结构化错误）＋R-01 | 已覆盖 |
| D-003@v1 | Phase 2/3（自研 ACP 驱动 + json-rpc 基建复用）＋文件清单 NEW:dsh-acp-driver.ts | 已覆盖 |
| D-004@v1 | rejected 登记（官方 ACP SDK 客户端落选）——非目标「不引入 @agentclientprotocol/sdk 依赖」条款 | 已覆盖（rejected） |
| D-005@v1 | rejected 登记（headless 批处理落选），非目标"批处理层不动" | 已覆盖（rejected） |

多裁定组合推演：D-001/D-002/D-003 相互独立（发现策略、版本门语义、驱动实现方式三轴无状态耦合——任意组合均无死锁格），无组合约束。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/非功能生命周期/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at；scale 留待 Step 8 规模评估落值）
- [x] 引用所有当前版本 D-001@v1 ~ D-005@v1
- [x] 涉及生命周期关键词 → 已含「生命周期契约表」（复用既有事件，无新增）
- [x] UI 原型分级核对：跳过（枚举微调，无布局/流程变化），用户 Step5 已确认，理由记入风险登记表
- [x] 不确定问题标注：无「⚠️ 自审存疑」项——R-05（patch 写入与 HMR 时序）为唯一实现期不确定点，已降级为 verify 用例覆盖项
