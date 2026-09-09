---
author: qinyi
created_at: 2026-09-08 11:53:55
scale: large
---

# 设计文档（Design）— cursor 交互式会话接入（每轮 respawn + --resume 薄 driver）

## 背景

SillyHub 平台的 agent 接入已抽象为三件套：AgentEvent v2 统一事件契约（`sillyhub-daemon/src/types.ts` + `agent-event-schema.ts`）、InteractiveProvider 注册表（`sillyhub-daemon/src/interactive/providers.ts`）、ProviderCaps 8 键能力矩阵（三端镜像 + 守护测试）。`docs/agent-provider-onboarding.md` 定义三档接入路径，pi 是首个档C 完整先例（2026-09-04-provider-pi-onboarding，已归档）。

cursor 当前是**半接入**状态：

- **批量任务链路已完整可用**：`agent-detector.ts` PROVIDER_SPECS 已有 cursor（bin=`cursor-agent`，env=`SILLYHUB_CURSOR_PATH`，protocol=stream_json）；`adapters/stream-json.ts` 有 cursor 专属 buildArgs/buildInput 分支（D-008@v1）；Windows 官方 ps1 版本目录损坏的绕过已落地（`cursor-version.ts`，ql-20260620-002-f8c1）；前端团队任务 worker 类型可选 Cursor；daemon 注册上报链路正常（2026-09-04 冒烟 7 provider online 含 cursor）。
- **交互式会话链路缺失**：`INTERACTIVE_PROVIDERS` 仅 claude/codex/pi；`PROVIDER_CAPS` 三端均无 cursor 条目；backend `daemon/schema.py:112` `InteractiveProviderLiteral = Literal["claude","codex","pi"]`（显式 provider 路径 422）；前端两处引擎白名单（`pre-session-picker.tsx` / `runtime-session-helpers.tsx`）不含 cursor；daemon 本地会话持久化白名单 `session-store-persistence.ts:85` VALID_PROVIDERS 不含 cursor（重启丢会话记录）。

用户需求：平台 agent 补充接入 cursor 的能力 = **补齐交互式会话链路**（能像 claude/codex/pi 一样开多轮对话会话）。

本机环境：cursor-agent 已安装（`%LOCALAPPDATA%/cursor-agent/versions/2026.06.16-20-30-07-a07d3ac`），CLI 能力已实测（--help 全量）：`--resume [chatId]`、`--continue`、`--model`、`--mode plan|ask`、`--list-models`、`--force/--yolo`、`--trust`（仅 print/headless 有效）、`--sandbox`、`--approve-mcps`、`create-chat`（建空 chat 返回 ID）、`worker`（**实测为 Cursor 云端 worker 注册通道**——K8s 探针/标签/池分配，非本地 stdio 会话协议，D-001@v1 否决依据）。**登录凭证已过期**（status 页显示已登录但 API 调用报 `Authentication required`，bash/cmd/powershell 三环境一致复现）——冒烟与前置实测前需用户重新 `cursor-agent login`。

## 设计目标

| 编号 | 目标 |
|---|---|
| FR-01 | cursor 注册进 interactive 三件套：INTERACTIVE_PROVIDERS + PROVIDER_CAPS 单源条目、backend/frontend 两镜像同步、三端对齐守护测试通过 |
| FR-02 | 新建 CursorDriver 实现 InteractiveDriver 契约：每轮 respawn + `--resume chatId` 串联多轮；事件产出 envelope-only 且逐条过 safeParseAgentEvent；interrupt/close 生命周期；Windows shim 解析 |
| FR-03 | 新建 cursor-events 归一化器：cursor stream-json 帧 → AgentEvent v2 无状态映射，golden 测试用真实帧 fixture 驱动 |
| FR-04 | 三端白名单放行：backend InteractiveProviderLiteral、daemon session-store-persistence VALID_PROVIDERS、前端两处引擎可选白名单 |
| FR-05 | 前置实测任务：真实帧样本抓取（两轮对话 + resume 记忆连续性验证）+ 非 force 权限行为探针（按 D-003@v1 判定规则回填结论） |
| FR-06 | 测试与冒烟验收：手册 §8 清单适配（typecheck + 相关测试 + 真机冒烟：建会话/双轨落库/多轮 resume/interrupt/caps 门控） |

## 非目标

- **批量层任何改动**——已可用，本变更零触碰（`adapters/`、`agent-detector.ts`、`task-runner.ts` 不动）。
- **liveness 推导器注册**（`agent-log/liveness/registry.ts` 现仅 codex/claude/zcode）——留后续变更，且避免与活跃变更 `2026-09-08-session-list-liveness-dot` 撞代码（D-002@v1）。
- **平台侧 Cursor 凭证配置**（`llm_provider.agent_kind` Literal 扩展 + CursorCredentialInjector + 设置页）——留后续变更（D-002@v1）；cursor-agent 走本机 `cursor-agent login` 凭证（与 codex 同模式）。
- **`--mode plan/ask`、`--worktree`、`--sandbox`、`--approve-mcps`、worker 等其余 CLI 能力映射**——按需留后续；v1 不映射（manualApproval/askUserOnly 选项忽略，caps 对应 false）。
- **mcpServers 注入**——cursor-agent CLI 无 per-session `--mcp-config` 参数（D-008@v1 实证，MCP 由其自身配置文件 + `--approve-mcps` 管理），caps.mcp=false，driver 忽略 mcpServers。
- **群聊引擎集与其它存量 provider 白名单面**——`group-chat/create-group-wizard.tsx` GROUP_SUPPORTED_PROVIDERS、`backend session_crud.py` `_SessionProviderQuery=Literal["claude","codex"]`（pi 亦缺的存量缺口）本变更不加 cursor，留后续统一收口（Grill CC-14）。
- **旧文本协议扩展**——新 provider 信息一律走 AgentEvent 一等字段 + metadata（手册 §2.1 纪律）。

## 拆分判断

- 为什么不走批量模式：需求本身就是交互式多轮会话；cursor 批量已有，本变更是补缺不是重做。
- 为什么是独立变更：与活跃变更无代码重叠——`2026-09-08-session-list-liveness-dot`（会话列表存活点）走 liveness 域，本变更不碰；`2026-09-07-pi-task-events`（pi 任务事件）走 pi 域。共享文件仅 `provider-registry.test.ts`（键集合断言），属注册表接入的必经同步点，不构成域重叠。
- 规模：三端多文件 + 新 driver 状态机 + 数据矩阵变更 → scale=large，四件套齐。

## 总体方案

### Wave 0：前置实测（人工配合，产出回填设计假设）

> 依赖用户先跑 `cursor-agent login` 修复凭证（浏览器流程）。

1. **抓帧样本**：在本机用版本目录入口直跑两轮真实对话（第一轮不带 resume、第二轮 `--resume <chatId>`），全程保存 stdout NDJSON 帧：
   - 验证 A：system/init 帧是否携带 `session_id`（批量 adapter 同款提取点）；result 帧形状与 usage 字段名（`input_tokens`/`output_tokens`/`cache_*`）；
   - 验证 B：`--resume` 的 chatId 与帧内 session_id 是否同一 ID 空间、第二轮是否保持第一轮记忆；
   - 验证 C：`--resume` 用 `create-chat` 返回的 ID 是否同样有效（兜底路径）。
   - 产出：真实 fixture 落盘 `sillyhub-daemon/tests/fixtures/cursor/*.ndjson`（golden 测试输入）+ 实测记录（帧形状结论）回填本变更目录。
2. **非 force 探针**：跑一次不带 `--force --trust` 的 headless 对话，观察工具调用行为：
   - 若工具被拒/卡死 → 落 `--force --trust`（与批量一致）+ permission_dialog=false，记 D-003@v2；
   - 若存在可用审批/降级行为 → 按实测结果设计审批通道，记 D-003@v2 复议 permission_dialog。

### Wave 1：daemon 核心（driver + 归一化器 + 注册）

**cursor-events.ts 归一化器**（无状态映射表模式，codex `toAgentEvent` 先例；映射表按 task-01 实测真实帧型修正——**cursor 帧并非 claude 同构子集**，thinking/tool 走顶层独立帧、usage 为 camelCase，详见 spike-cursor-frames.md）：

| cursor 帧（task-01 实测，spike-cursor-frames.md） | AgentEvent 产出 |
|---|---|
| `system`（init，7 键：session_id/model/permissionMode/apiKeySource/cwd） | `status` + `subtype='session_started'`，携带 `session_id` |
| `user` 帧（**每轮回显用户 prompt**，claude 仅 tool_result 时发） | 忽略（不透传，防重复渲染用户消息） |
| `assistant` message content 文本块（实测仅 {type:text,text}，无 tool_use 块） | `text`（逐块，完整事件） |
| `thinking` **顶层帧**（subtype=delta 增量 text / completed 无 text） | delta→`thinking`（`is_partial`+`segment_id` 流式）；completed→吸收（流收尾标记，不产事件） |
| `tool_call` **顶层帧** started（call_id / tool_call 判别联合 / model_call_id） | `tool_use`（`tool_name` 取判别键如 `shellToolCall`，原生保留不重命名；`call_id` 配对） |
| `tool_call` completed（result.success.{exitCode,stdout,stderr,executionTime}） | `tool_result`（`call_id` 配对；stdout/stderr 进 content，exitCode 进 metadata） |
| `result` 帧（subtype=success；usage 为 **camelCase**：inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens） | `turn_result` + usage 四字段短名映射（input/output/cache_read/cache_creation）+ `session_id` |
| `connection` / `retry` 帧（传输层） | 忽略 |
| stderr 行（driver 层嗅探） | `error` |
| 未知帧型 | `status` + `subtype='task_notification'` 降级 + `metadata.original_event_type` 保留原值，不丢弃不抛错 |

- 每条产出过 `safeParseAgentEvent`；`type='status'` 必带 `subtype`；usage 短名 `input_tokens/output_tokens/cache_read_tokens/cache_creation_tokens/ctx_tokens`（cursor 侧无 ctx 维度，缺省）。
- 函数形态：`normalizeCursorFrame(frame: unknown): AgentEvent[]`（纯函数无跨帧状态；chatId/thinking 流缓冲状态归 driver）。
- **注意**：`tool_call.call_id` 字符串内含字面 `\n`（实测），下游按 call_id 拼接/分行逻辑不得按行拆分 call_id。

**cursor-driver.ts**（`implements InteractiveDriver`，pi 直 spawn 模式变体）：

- **启动参数**：`-p --output-format stream-json --trust [--resume <chatId>] [--model <model>] [--force] <prompt>`（`--force` 与否由 D-003@v2 定；prompt 为位置参数，stdin 留空——批量 buildArgs 同款）。不加 `--workspace`（CLI 缺省=cwd，与批量层口径一致），spawn `cwd = options.cwd`。
- **每轮生命周期**：`consume` 内 `for await (turn of inputQueue)` → spawn 子进程 → stdout 逐行 NDJSON → `normalizeCursorFrame` → `onTurnMessage({events})`（envelope-only，raw 仅 `SILLYHUB_DEBUG_RAW_EVENTS=1`）→ 收到 result 帧后等进程退出 → `onTurnResult({subtype, is_error, usage, session_id})` → 下一轮。
- **chatId 管理**（driver 实例内状态）：优先级 `options.resume`（首启恢复）→ 上一轮捕获值 → 首轮从 system/init 帧捕获（result 帧备份）→ 兜底 `create-chat` 子命令（Wave 0 验证 C 确认可用性）。后续轮 spawn 自动追加 `--resume <chatId>`。
- **收敛与异常**：result 帧 + exit 0 → 正常收敛（usage 取 result 帧）；进程退出无 result 帧 → exit≠0 判 `is_error=true`、exit=0 按正常收敛（usage 缺省）；spawn 失败/流异常 → `onTurnError` 上报不吞（E3）。
- **interrupt(handle)**：有 running child → driver 先置 interruptPending 标记再 kill 进程树（Windows `taskkill /PID <pid> /T /F`；posix 以 `detached:true` 起进程组后 `process.kill(-pid)` 杀组）→ 当前轮以 `{subtype:'error_during_execution', is_error:true}` 收敛（不再等 result 帧）。subtype 取值依据 backend 终态映射（`close_run_steps.py:219-224` 注释明示 `error_during_execution` = interrupted turn / SDK abort 通道 → AgentRun=failed + error_code='interactive_interrupted'，claude SDK abort 同款语义；pi 报 success→completed 是手册 §5.3 记录的存量偏差，不效仿——Grill B-02）→ 返回 true；无 child → false 不冒泡。
- **close()**：幂等 kill + 清理（不动 input 队列——E4 完整语义：回调不缓存复用 + 队列只消费不 mutate/close）。
- **handle.processId**：每轮 respawn 下为可变镜像——start() 时无子进程（undefined），每轮 spawn 后更新为当前 child.pid、turn 收敛后置回 undefined（E5：handle.provider='cursor' 恒定，processId 仅可观测字段）。
- **Windows shim**：`pathToAgentExecutable`（daemon `_agentPaths.get('cursor')` 经 CreateSessionInput 注入）在 win32 且为 `.cmd/.bat/.ps1` → `resolveWindowsCmdShim` 解析（mode-0 已含 cursor-agent.ps1 → 版本目录 node 入口增强，典型 PATH 探测结果 cursor-agent.cmd 走此链）→ `spawn(exe, [...prependArgs, ...args], {shell:false})`；解析失败回退 `shell:true`——**但 .ps1 直连除外**：cmd.exe 跑不了 ps1，该边缘显式回退 `powershell -NoProfile -ExecutionPolicy Bypass -File <ps1>` 包装（参数照 cmd-shim.ts:78 先例，Grill CC-05）。防 spawn EINVAL 已知坑（ql-20260624-002-b2f7：任何自 spawn 路径必须先解 shim）。
- **忽略的 StartOptions**：`manualApproval`/`askUserOnly`/`mcpServers`/`blocks`（附件）——caps 对应 false，docblock 声明"忽略：无对应 CLI 通道"。
- **env**：`options.env` 透传子进程（凭证注入通道预留，v1 不实现 CursorCredentialInjector）。
- **E 系列契约**：E3（异常不吞）、E4（回调不复用不缓存）、E5（handle.provider='cursor' 自填，interrupt 路由校验）、E7（handle 不可序列化不落盘）。

**注册（providers.ts）**：

- `PROVIDER_CAPS.cursor`：`resume: true, mcp: false, multimodal: false, thinking: true, subagent: false, permission_dialog: false, edit_patch: false, model_select: true`（docblock 逐键取值依据锚点，照 claude/codex 注释块格式）。resume/model_select 的依据=driver 实现的 `--resume`/`--model` 通道 + CLI 实测；**thinking=true（task-01 实测修正：顶层 thinking 帧稳定存在且有 fixture 样本，归一化器映射 delta→thinking 流式）**；其余五键=无通道或未验证（§6.2 先实现后翻 true）。resume=true 的 Wave 0 前置已通过（验证 B 记忆连续，spike-cursor-frames.md）。
- `INTERACTIVE_PROVIDERS.cursor`：`{ provider:'cursor', family:'stream_json', displayName:'Cursor', createDriver: () => new CursorDriver(), caps: capsOf('cursor') }`。family='stream_json' 与批量层 PROTOCOL_PROVIDERS 反查一致（守护测试断言）。
- `cli.ts:807` drivers 装配对象加 `cursor: new CursorDriver()`（`_getDriver` 走 deps.drivers 注入，descriptor 工厂不被消费——手册档B 步骤 10 补充必改点）。
- `session-store-persistence.ts:85` VALID_PROVIDERS 加 `'cursor'`（否则 daemon 重启丢本地会话记录，靠 backend auto-recover 兜底是已坑）。

### Wave 2：backend + frontend 镜像与放行

- backend `agent/provider_caps.py`：`PROVIDER_CAPS['cursor']` 八键逐键与 daemon 单源一致；**同步必改**守护测试 `backend/app/modules/agent/tests/test_provider_caps_alignment.py` 的 `EXPECTED_PROVIDERS`（现硬编码 `{"claude","codex","pi"}`，加 'cursor'——漏改则 `test_provider_sets_identical` 必失败，Grill B-01）。
- backend `daemon/schema.py:112`：`InteractiveProviderLiteral = Literal["claude","codex","cursor","pi"]`（防显式 provider 路径 422；runtime_id 入口本就可绕过——pi 冒烟 F-1 先例）。
- frontend `lib/provider-caps.ts`：镜像同款。
- frontend `components/sessions/pre-session-picker.tsx:47` `SESSION_SUPPORTED_PROVIDERS` 与 `components/daemon/runtime-session-helpers.tsx:67` `SUPPORTED_SESSION_PROVIDERS` 加 `"cursor"`（门户主路径 + 对话框路径两处硬编码白名单）。
- frontend `lib/daemon/runtimes.ts` PROVIDER_META 已有 cursor（label='Cursor'，icon='🟡'）——零改动；MIN_VERSIONS 不加（PROVIDER_SPECS.cursor 无 minVersion）。
- `normalizeProvider` 零改动：adapter id `cursor` 与 detector key 同名直通。
- SessionManager / daemon 事件上报链 / backend `_persist_agent_event` / 前端 normalize 双轨：对 cursor 全零改动（抽象层收益，逐点核对清单见手册档C 第 10 步）。

### Wave 3：验收与文档

- 测试：`provider-registry.test.ts` 键集合断言改 `['claude','codex','cursor','pi']`（+ 实例化/family 反查断言补齐）；新增 `cursor-events.test.ts`（golden：fixture 进、AgentEvent[] 出、逐字段断言）+ `cursor-driver.test.ts`（start/consume/interrupt/handle 生命周期 + envelope-only + E3/E5，参照 `codex-app-server-driver.test.ts`）；backend caps 对齐守护测试（EXPECTED_PROVIDERS 已同步 cursor 后为覆盖源，见 B-01 修正）。
- typecheck：`pnpm -C sillyhub-daemon typecheck` + `pnpm -C frontend typecheck`。
- 冒烟（手册 §8 适配，需登录已修复）：daemon 探测 cursor available → 前端建 cursor 会话跑一轮真实对话（双轨落库 + SSE agent_event + usage）→ 第二轮 resume 记忆连续 → interrupt 打断进行中 turn → caps false 项 UI 正确隐藏（附件/审批/团队派工）→ model_select 开放且 `--model` 生效。
- 文档：`docs/agent-provider-onboarding.md` 追加 §5.4 cursor 案例锚（对照 §5.3 PI 案例格式，含 respawn-per-turn 模式差异、坏 ps1 绕过复用、D-003 实测结论）；归档时按 module-impact 同步模块文档。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | sillyhub-daemon/src/interactive/cursor-events.ts | 归一化器：`normalizeCursorFrame(frame): AgentEvent[]` 无状态映射表 + 帧型→事件映射 docblock（含未知帧降级桶） |
| 新增 | sillyhub-daemon/src/interactive/cursor-driver.ts | CursorDriver：每轮 respawn + `--resume chatId`；Windows resolveWindowsCmdShim；E3/E4/E5/E7 契约 |
| 新增 | sillyhub-daemon/tests/interactive/cursor-events.test.ts | golden 测试：真实 fixture 进、AgentEvent[] 出、逐字段断言 |
| 新增 | sillyhub-daemon/tests/interactive/cursor-driver.test.ts | driver 单测：生命周期/interrupt/envelope-only/E3/E5（参照 codex-app-server-driver.test.ts） |
| 新增 | sillyhub-daemon/tests/fixtures/cursor/*.ndjson | Wave 0 抓取的真实帧样本（golden 输入） |
| 修改 | sillyhub-daemon/src/interactive/providers.ts | PROVIDER_CAPS.cursor（8 键 + 取值依据 docblock）+ INTERACTIVE_PROVIDERS.cursor（family='stream_json'）；caps 数据流：producer=本文件单源 → 镜像 backend/frontend（手工同步）→ consumer=三端 getProviderCaps/get_provider_caps 门控 + 守护测试源文件读取断言 |
| 修改 | sillyhub-daemon/src/cli.ts | drivers 装配对象加 `cursor: new CursorDriver()`（L807 附近，硬编码必改点） |
| 修改 | sillyhub-daemon/src/interactive/session-store-persistence.ts | VALID_PROVIDERS 加 'cursor'（L85，防 daemon 重启丢本地会话记录） |
| 修改 | sillyhub-daemon/tests/interactive/provider-registry.test.ts | 键集合断言 `['claude','codex','cursor','pi']` + 实例化/family 反查断言同步 |
| 修改 | backend/app/modules/agent/provider_caps.py | PROVIDER_CAPS 加 cursor 字典（八键与 daemon 逐键一致，镜像） |
| 修改 | backend/app/modules/agent/tests/test_provider_caps_alignment.py | EXPECTED_PROVIDERS 加 'cursor'（L52 现硬编码三 provider；漏改则三端表加 cursor 后 test_provider_sets_identical 必失败——Grill B-01，pi 接入 commit 7c4dd4efd 同款先例） |
| 修改 | backend/app/modules/daemon/schema.py | InteractiveProviderLiteral 加 "cursor"（L112）。DTO 对外字段数据流：producer=前端会话创建请求 `provider` 字段 → backend `SessionCreateRequest.provider`（本 Literal 校验）→ daemon CreateSessionInput.provider → INTERACTIVE_PROVIDERS 注册表路由 + `_agentPaths.get(provider)` 取 exe 路径；consumer=driver-factory getDriver |
| 修改 | frontend/src/lib/provider-caps.ts | PROVIDER_CAPS 加 cursor（镜像，逐键一致） |
| 修改 | frontend/src/components/sessions/pre-session-picker.tsx | SESSION_SUPPORTED_PROVIDERS 加 "cursor"（L47 门户主路径引擎白名单） |
| 修改 | frontend/src/components/daemon/runtime-session-helpers.tsx | SUPPORTED_SESSION_PROVIDERS 加 "cursor"（L67 对话框路径白名单） |
| 修改 | docs/agent-provider-onboarding.md | 追加 §5.4 cursor 案例锚（respawn-per-turn 模式、实测结论、坑记录） |

说明：后端 schema DTO 变更**无需** `pnpm gen:types` 联动——`InteractiveProviderLiteral` 是请求侧字面量校验（请求体校验），不产生新的响应类型字段；前端消费的 runtime 列表类型不变。若 execute 期发现 `api-types.ts` 中该 Literal 有导出引用，则在同一 change 内补跑 `pnpm gen:types` 并提交双产物（CLAUDE.md 规则 21）。

## 接口定义

```ts
// sillyhub-daemon/src/interactive/cursor-driver.ts

/** cursor 专属启动选项（经 CreateSessionInput 传入，值来自 daemon _agentPaths.get('cursor')）。 */
export interface CursorDriverStartOptions extends InteractiveDriverStartOptions {
  /** cursor-agent 可执行入口（.cmd/.ps1/或直 exe；Windows 下经 resolveWindowsCmdShim 解析）。 */
  pathToAgentExecutable: string;
}

export class CursorDriver implements InteractiveDriver {
  start(
    input: AsyncIterable<UserTurnInput>,
    options: CursorDriverStartOptions,
  ): Promise<InteractiveDriverHandle>;
  consume(handle: InteractiveDriverHandle, callbacks: InteractiveDriverCallbacks): Promise<void>;
  interrupt(handle: InteractiveDriverHandle | null): Promise<boolean>;
}
// handle: { provider: 'cursor', processId: <当前轮子进程 pid>, close() }
// 契约来源：interactive/driver.ts（start/consume/interrupt 三方法 + E3/E4/E5/E7）

// sillyhub-daemon/src/interactive/cursor-events.ts

/** 单帧归一化：cursor stream-json 帧 → 0..N 条 AgentEvent（无状态纯函数）。 */
export function normalizeCursorFrame(frame: unknown): AgentEvent[];
```

启动参数拼装（伪代码，与批量 buildArgs cursor 分支对齐）：

```
args = ['-p', '--output-format', 'stream-json', '--trust']
if (chatId) args += ['--resume', chatId]        // options.resume 或本 driver 捕获值
if (options.model) args += ['--model', options.model]
if (forceMode) args += ['--force']              // D-003@v2 实测结论定
args.push(turn.text)                            // prompt 位置参数；stdin 空
```

## 生命周期契约表

本变更新增 provider 但**复用既有 interactive 会话生命周期**（不新增事件类型）；cursor driver 必须正确履行以下既有事件：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 | cursor driver 落点 |
|---|---|---|---|---|---|
| claim lease | daemon | backend | leaseId, claimToken, agentRunId | pending → running | 既有链路零改动（SessionManager.create 前） |
| create session | backend | daemon | sessionId, leaseId, claimToken, provider | session active | provider='cursor' 经注册表路由到 CursorDriver.start |
| submit message（每轮） | 用户/daemon | cursor-agent 子进程 | turn.text（位置参数） | turn running | consume 循环内 spawn + `--resume chatId` |
| 中间事件（每帧） | cursor-agent | backend（经 SessionManager→hub-client） | events[]（AgentEvent，过 safeParseAgentEvent） | AgentRunLog append | normalizeCursorFrame → onTurnMessage envelope-only |
| turn result | cursor-agent 进程退出 | daemon → backend | subtype, is_error, usage, session_id | AgentRun running → completed/failed | result 帧 + 进程退出双确认 → onTurnResult（runId 为 SessionManager 层上下文非 driver 契约字段，Grill CC-09） |
| interrupt | 用户 | daemon → driver | sessionId | 当前 turn 中止 | kill 进程树 → interrupted 收敛 → true |
| session end / close | daemon | backend | sessionId, reason | active → ended | handle.close() 幂等 kill |
| daemon 重启恢复 | daemon | backend | sessionId, provider | suspended → resumed | VALID_PROVIDERS 含 cursor 后 sessions.json 记录可载入（restore 链零改动） |

对账：表中 submit message/中间事件/turn result/interrupt/close 五事件有对应代码任务（Wave 1 driver 任务）与测试任务（cursor-driver.test.ts / cursor-events.test.ts）；claim lease/create session/daemon 重启恢复为既有链路（注册点任务覆盖 provider 放行），无新增 DTO 字段（session_id 复用 InteractiveDriverResult.session_id 既有字段）。

## 数据模型

无 schema 变更。不新增表、不改列：provider 值 'cursor' 存量字段即可承载（`AgentRun.agent_type` 为自由字符串 String(30)；`DaemonRuntime.provider` 同）；caps 为三端硬编码表非 DB。

## 兼容策略（brownfield 必填）

- **未配置/未安装 cursor 的环境行为不变**：探测 unavailable → 无 runtime → 前端不展示（动态列表）；caps 未知 provider 全 false 的默认拒绝语义不受影响。
- **既有三 provider 零回归**：注册表新增键不改既有条目；`provider-registry.test.ts` 键集合断言同步属预期演进；SessionManager/上报链/backend `_persist_agent_event`/前端 normalize 对 cursor 全零改动。
- **回退路径**：本变更不涉及 daemon/backend 协议面改动（无新消息 kind、无 OpenAPI 响应变更），无错配窗口；若 cursor driver 有问题，前端不选 cursor 引擎即可完全回避（其余 provider 不受影响）。`SILLYHUB_LEGACY_TEXT_EVENTS` 开关与本变更无关（事件轨形态不变）。
- **不改变的 API/表结构**：见数据模型节；`InteractiveProviderLiteral` 是请求侧校验放宽（加成员），不破坏既有请求。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 帧结构假设依赖批量层代码推断（登录过期阻塞即时实测）：system 帧是否带 session_id、result 帧形状/usage 字段名未真机验证 | P0 | Wave 0 前置实测先行：登录修复后抓真实帧样本落 fixture，golden 测试用真实样本；实测记录回填设计假设；不符则按实测修正归一化器映射表 |
| R-02 | `--resume` chatId 与帧内 session_id 可能不同一 ID 空间 | P0 | Wave 0 验证 B/C：帧内捕获与 create-chat 两来源交叉验证；driver chatId 管理设计为多来源优先级 + 兜底，实测后收敛为单一来源 |
| R-03 | 非 force 行为未知（工具被拒/卡死/有审批） | P1 | D-003@v1 判定规则前置：实测后按结论落参数 + 记 @v2；若卡死风险则首版强制 --force --trust（与批量一致） |
| R-04 | 每轮 spawn 开销（进程启动 + Node 引导，估 1-3s/轮）与 interrupt 无细粒度 steer（kill=整轮中止） | P2 | 产品语义可接受（会话制非流式追问）；性能感受留后续优化空间（如进程复用属协议层重构，超出本变更） |
| R-05 | cursor-agent 自更新换版本目录（versions/ 多版本并存）导致路径漂移 | P2 | 已有机制覆盖：detector 每次启动重新探测最新版本目录（cursor-version.ts 降序取最新）；`SILLYHUB_CURSOR_PATH` env 可钉死 |
| R-06 | UI 原型跳过风险登记：本变更前端改动为白名单 + caps 数据表条目，无页面布局/交互流程变化（cursor 引擎复用既有会话 UI，PROVIDER_META 已有 label/icon），按原型分级规则属"跳过"档 | P2 | 无需原型；若 execute 期前端出现超预期改动（如引擎特化 UI），补生成原型并回填本表 |
| R-07 | thinking/tool 帧型在 cursor 输出中可能存在但未验证 | P2 | **已解除（task-01 实测）**：thinking 顶层帧与 tool_call 帧对均稳定存在且有 fixture 样本，归一化器已映射（tool-use-probe.ndjson），caps.thinking 随实现翻 true |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | driver 架构（每轮 respawn + --resume chatId 薄 driver）→ 总体方案 Wave 1 / FR-02；B/C 否决证据已录 decisions.md | 已覆盖 |
| D-002@v1 | 范围仅最小闭环 → 非目标节 / FR-01~06 | 已覆盖 |
| D-003@v2 | 权限模式定版 --force --trust + permission_dialog=false（task-02 实测回填，supersedes D-003@v1）→ Wave 0 探针任务 / FR-05 / R-03 | 已覆盖（已回填） |
| D-004@v1 | caps 守护测试 EXPECTED_PROVIDERS 同步必改 → Wave 2 / 文件变更清单（Grill B-01 修正） | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@v1（D-001/D-002/D-003/D-004，见决策追踪）
- [x] 涉及 session/daemon/lifecycle 关键词 → 含「生命周期契约表」（复用既有事件 + cursor driver 落点对账）
- [x] UI 原型分级核对：跳过，原因已记入风险登记 R-06（非静默缺位）
- [x] 代码锚点实读核对：providers.ts（PROVIDER_CAPS L118-151 / INTERACTIVE_PROVIDERS L259-286）、driver.ts（三方法签名 L255-279（含 interrupt L274-279）/ StartOptions L154-188 / Result.session_id L125）、cli.ts:807、session-store-persistence.ts:85、schema.py:112、pre-session-picker.tsx:47、runtime-session-helpers.tsx:67、test_provider_caps_alignment.py:52（EXPECTED_PROVIDERS 硬编码三 provider——Grill B-01 修正后纳入清单）
- [x] caps 取值遵循"先实现后翻 true"（§6.2）：resume/model_select 有 driver 通道依据，其余六键无通道或未验证一律 false
- [ ] ⚠️ 自审存疑 1：cursor stream-json 帧与 claude 子集的同构程度（R-01）——批量层代码证据强但非逐帧实证，已以前置实测 + fixture 对冲，存疑保留至 Wave 0
- [ ] ⚠️ 自审存疑 2：`--trust` 与 `--force` 的组合必要性（--trust 仅 print/headless 有效；非 force 探针是否还需要 --trust）——Wave 0 探针任务中一并实测确认
