---
author: qinyi
created_at: 2026-09-11 16:48:58
scale: large
---

# 设计文档（Design）— 2026-09-11-session-provider-switch-codex-pi

## 背景

平台会话级供应商切换（SessionConfigBar 下拉 + 错误卡「切换供应商」按钮 → injectSession 携 `llm_provider_id` → backend `SESSION_SWITCH_CONFIG` → daemon turn 边界 reload）目前 **claude-only**：

- 前端两处门禁写死：`session-panel-page.tsx:2358`（错误卡按钮，`session.provider !== "claude"` 弹「当前引擎不支持会话级供应商切换」）与 `session-config-bar.tsx:270`（`providerLocked = effectiveEngine !== "claude"`，下拉锁死）。
- daemon reload 内核 `_reloadSessionNow` 只走 `buildSpawnEnv`（env 层）：codex 二进制不读任何凭证 env（spike A1，`credential-injector.ts:258` 刻意不注册 codex env 注入器），pi 自定义端点走文件层（`PI_CODING_AGENT_DIR`）。reload 不调 `applyProviderFileSettings`，也不保留 `CODEX_HOME` / `PI_CODING_AGENT_DIR` env → 切了也不生效。
- `reloadWithProvider`（`session-manager.ts:1502`）对非 claude 直接抛错——PROVIDER_CONFIG_CHANGED 默认供应商热切换对 codex/pi 只有 daemon.ts:7713 的尽力文件重写、无确定性重启。

2026-09-10-multi-provider-injection 已补齐 **spawn 时**的 codex/pi 凭证注入（新会话必生效）与 /settings 表单，但显式不包含会话内切换解锁（module-impact 前端仅 llm-providers 表单）。backend inject 侧已天然支持任意引擎的会话级切换（`inject_gates.py:556` agent_kind 与会话引擎匹配校验，422 不静默降级）。本变更补齐 daemon reload 链路 + 前端解锁，达成与 claude 完全对齐。

## 设计目标

1. **FR-01**：codex/pi 会话内可切换供应商（供应商→供应商），确定性生效（turn 边界 reload 重启引擎子进程），对话历史保留；且切换后 daemon 重启恢复不丢供应商（restore 自愈，Wave 2 步骤 4）。
2. **FR-02**：codex/pi 会话内可切回「不指定（本机默认）」（D-001）：
   - codex：不丢 `CODEX_HOME`（thread 历史在 `$CODEX_HOME/sessions` 下），把宿主 `~/.codex` 的 auth.json / config.toml **镜像拷贝**进 per-session 目录（宿主无文件则清掉 per-session 两文件 = 如实反映宿主未登录）；
   - pi：丢 `PI_CODING_AGENT_DIR` env 回宿主 `~/.pi`（pi 会话历史在 daemon 自管 `--session-dir`，`pi-rpc-driver.ts:686/719`，不受影响）。
3. **FR-03**：供应商下拉按会话引擎过滤 agent_kind（codex 会话只列 codex kind，pi 只列 pi kind，claude 只列 claude kind——顺手修掉现状全量展示选错 kind 撞 422 的坑）；「不指定（本机默认）」全引擎保留（D-002）。
4. **FR-04**：`reloadWithProvider` claude-only 守卫删除后，PROVIDER_CONFIG_CHANGED 默认供应商热切换对 codex/pi 升级为确定性 reload（对齐 claude 语义；D-003）。
5. **FR-05**：codex 从宿主凭证起步的会话首次切平台供应商时，迁移该线程的 rollout 历史从宿主 `~/.codex/sessions` 到 per-session 目录（对齐 claude 的 `migrateClaudeTranscriptToIsolated` 语义，不迁移则新 CODEX_HOME 下 resume 找不到 thread 必断）。

## 非目标

- 不做 cursor 解锁（spike 已证私有云协议无 BYO 注入面，`2026-09-10-multi-provider-injection` D-007 入档）；gemini 未注册不涉及。
- 不改 backend（inject/SESSION_SWITCH_CONFIG/422 校验/null 下发语义均已就位；预期零 backend 改动，execute 中若发现缺口再最小补）。
- 不改 `ProviderCaps` 9 键矩阵（三端同步成本高；前端用本地白名单常量，见接口定义）。
- 不做 pi 宿主凭证镜像（pi 历史不在 `PI_CODING_AGENT_DIR`、凭证回宿主 `~/.pi` 语义天然成立，无需镜像）。
- 不做 codex 反向迁移（provider→null 不迁历史回宿主——镜像方案下 CODEX_HOME 不丢，无需反向）。
- 不动 daemon.ts:7713 既有热切换尽力重写（幂等无害，保留作 reload 前的兜底预写）。

## 拆分判断

单一连贯变更不拆：codex 镜像/迁移、reload 内核接入、前端解锁三者互为验收依赖（解锁不接内核=切了不生效的静默故障，接内核不解锁=无 UI 入口），拆开产生不可验收的中间态。Wave 按「共享模块抽取（纯移动+新 helper）→ reload 内核接入 → 前端解锁 → 测试收口」串行。

## 总体方案

### Wave 1：daemon 共享模块抽取 + codex null/迁移 helper（纯新增，零行为变化）

1. **抽取**：`applyProviderFileSettings` + `isCodexFormSufficient` / `isPiFormSufficient` / `nonEmptyStr` + `ProviderFileSettingsInput` 从 `task-runner.ts` 平移到新文件 `sillyhub-daemon/src/provider-file-settings.ts`（纯移动，逻辑逐字不变）；`task-runner.ts` / `daemon.ts` 改 import（task-runner 可 re-export 保测试兼容，或测试改 import——plan 定，倾向直接改 import 不留 re-export）。
2. **新增 reload 变体**（同文件）：`applyProviderFileSettingsForReload(input)`——**失败语义与 spawn 版刻意不同**（Grill P1-1 修正）：
   - provider 非 null：与 spawn 版同分派同产物（codex 门槛缺 → warn 跳过但**返回 priorEnv 的 CODEX_HOME 键**（若有）——异常配置场景下等同未切而非丢文件层 env，Grill 复审 P2-1；pi 官方端点 → {} 走 env 层；写盘/mkdir IO 失败 → **返回 priorEnv 的文件层键**（`{CODEX_HOME: <prior>}` / `{PI_CODING_AGENT_DIR: <prior>}`），目录里旧供应商产物未动 = 新进程沿用旧供应商，行为等同未切，error 日志可归因）；priorEnv=undefined（restore 路径）且失败时 prior 键取不到 → 返回 {}（降级=按宿主现状运行，与 create 失败语义对齐：codex resume 真实报错收敛 / pi 回宿主凭证，error 可归因——Grill 复审 P2-2，测试锁定）；
   - provider 为 null（切回本机）且 priorEnv 带 `CODEX_HOME`（此前在平台供应商上）：调 `mirrorCodexHostAuth`，**无论镜像成败都返回 `{CODEX_HOME: <prior 目录>}`**（镜像失败则目录里旧供应商凭证仍在 = 等同未切；env 保住 = codex thread 历史保住）；
   - provider 为 null 且无 prior `CODEX_HOME`（宿主起步会话）或 pi kind：返回 `{}`（env 不带文件层键 = 回宿主）。
   绝不抛，reload 主路径不阻断；调用方只管 `Object.assign(newEnv, fileEnv)`，失败兜底语义完全内聚在本函数（R-05 落地点）。
3. **codex-settings.ts 新增两 helper**：
   - `mirrorCodexHostAuth(codexHome)`：宿主 `~/.codex/{auth.json, config.toml}` 存在则拷入 codexHome（覆盖平台供应商产物）；不存在则删除 codexHome 下同名两文件。IO 失败 error 日志不抛（由 ForReload 兜底为「返回 prior CODEX_HOME=等同未切」）。
   - `migrateCodexThreadFromHost(threadId, codexHome)`：扫描宿主 `~/.codex/sessions/**/*.jsonl` rollout 文件，读**首行**的会话 id（fixture 证据为 `payload.session_id`，仓内原型 archive/2026-08-23-agent-log-conversation-view:153-158；execute 时以实际 rollout 首行为准兼容读 `session_meta.id`）匹配 threadId，命中文件按 sessions/ 下相对路径拷入 `$codexHome/sessions/`。宿主目录不存在 / 无命中 → warn 返回 false（reload 继续，resume 失败由 codex 真实报错收敛，对齐 claude 迁移失败降级 R-01 语义）。

### Wave 2：reload 内核接入 + 守卫删除 + restore 自愈

1. `SessionManagerDeps` 增可选 `daemonApiKey?: string | null`（**Grill P1-2 修正：生产构造点在 cli.ts:807**（daemon.ts:1957 仅经 DaemonOptions 接收成品）——cli.ts 装配处传 daemon 侧 api_key，与 spawn 路径 daemon.ts:8266 同源；缺省 null 仅影响 codex openai_chat 形态 litellm key，同 spawn 缺省语义）。
2. `_reloadSessionNow` 在 `applyTranscriptConfigDir` 之后、driver.start 之前，对 `state.provider === 'codex' || 'pi'`：
   - **迁移钩子**（仅 codex）：`providerConfig != null && !oldEnv['CODEX_HOME'] && state.agentSessionId` → `await migrateCodexThreadFromHost(state.agentSessionId, codexHome)`（codexHome 为确定性派生路径 `<daemonStateDir()>/codex/<sessionId>`）；
   - **写盘 + env 合并**：`const fileEnv = await applyProviderFileSettingsForReload({ sessionKey: state.sessionId, provider: providerConfig, daemonApiKey: this.deps.daemonApiKey, priorEnv: oldEnv })`，`Object.assign(newEnv, fileEnv)`（文件层 env 最后合并盖过下层，与 daemon.ts:8285 spawn 路径同模式——per-session 隔离目录是平台更高意志；失败兜底已内聚在 ForReload 返回值，见 Wave 1）。
3. `reloadWithProvider`（session-manager.ts:1502）删 `state.provider !== 'claude'` 抛错守卫——内核已 provider-generic；更新锁死该行为的回归测试为「codex/pi 走通 reload」。
4. **restore 自愈**（Grill 附带发现收编）：`interactive/session-manager/persistence.ts` 恢复路径（:290 一带，restoreEnv 仅 buildSpawnEnv）对 codex/pi 会话**同样调 ForReload 并 Object.assign**（priorEnv 传 undefined——恢复时无旧 env；providerConfig 非 null 即写盘+注 env）。不修则「切换后 daemon 重启 → 恢复会话丢 CODEX_HOME/PI_CODING_AGENT_DIR → 静默回宿主凭证」，直接击穿 FR-01 的生效承诺。**null 切换的 codex 会话（Grill 复审 P2-3）**：providerConfig 不落盘（persistence 仅存非 null）→ 恢复按无供应商处理会回宿主 CODEX_HOME → thread 在 per-session 目录找不到 → resume 断（响亮）；修法=恢复路径对 codex 且 providerConfig 空时**探测确定性 per-session 目录存在**（stat `<daemonStateDir()>/codex/<sessionId>/`）→ 存在则按 null 切换语义处理（mirrorCodexHostAuth + 注 CODEX_HOME，幂等重镜像无害）→ thread 历史保住；目录不存在 → 行为逐字不变。pi null 恢复不适用（null=回宿主即语义本身，历史在 --session-dir 不丢）。claude 恢复链路零变化。
5. claude 路径零变化：文件层合并块对 claude 不执行（claude 的 settings.json 链路仍归 daemon.ts spawn 侧 `applyClaudeSettings` + reload 既有 env 逻辑）。

### Wave 3：前端解锁 + 过滤

1. `frontend/src/lib/provider-caps.ts` 导出 `PROVIDER_SWITCH_ENGINES = new Set(['claude','codex','pi'])`（前端本地常量，注释声明依据 = daemon 注入面并集：env REGISTRY（claude/pi）∪ 文件层（codex/pi），非 ProviderCaps 键，避免三端同步）。
2. `session-config-bar.tsx`：
   - `providerLocked` 改为 `effectiveEngine != null && !PROVIDER_SWITCH_ENGINES.has(effectiveEngine)`（cursor/未知引擎仍锁）；:133 注释「engine≠claude 锁供应商（D-010）」同步改写；锁定态 title 文案「Codex 引擎暂不支持会话级供应商」（:468，写死 codex）改引擎中性「当前引擎不支持会话级供应商切换」（解锁后剩余锁定对象是 cursor/未知引擎，Grill P2 修正）。
   - 供应商下拉候选改 `providers.filter(p => p.agent_kind === effectiveEngine)`（effectiveEngine 为 null 的悬浮助手 provisional 形态维持全量——创建时才定引擎）。
   - 「不指定（本机默认）」项全引擎保留（现状渲染即如此，不动）。
3. `session-panel-page.tsx:2353-2361` `timelineOnSwitchProvider`：保留 `session?.provider &&` 前置（provider 未知/空 = 不拦截，现状语义），仅把 `!== "claude"` 改为 `!PROVIDER_SWITCH_ENGINES.has(session.provider)`（cursor/未知仍弹「当前引擎不支持会话级供应商切换」，文案不变；Grill P2：白名单化不得顺手收窄 null 放行）。

### Wave 4：测试收口

- daemon 单测：provider-file-settings 平移回归（既有 `tests/daemon-provider-file-dispatch.test.ts` 与 `tests/provider-injection-smoke.integ.test.ts`（:44 直引 task-runner 符号）改 import 后全绿）+ ForReload 分派矩阵（非 null 成功 / IO 失败→prior 键兜底 / 门槛缺→prior 键 / IO 失败+priorEnv undefined→{} / null+prior CODEX_HOME 镜像成败均返 prior 键 / null+pi 返 {}）+ mirror（宿主有/无/IO 失败）+ 迁移（命中/无命中/宿主缺目录）；reload 内核 codex/pi env 合并与 codex 迁移触发条件；reloadWithProvider codex 走通；persistence restore 对 codex/pi 注文件层 env（providerConfig 非 null happy path / IO 失败→{} 降级 / codex null+目录存在→镜像+注 env / 目录不存在→零动作）；cli.ts 装配传 daemonApiKey 锚定。
- frontend 单测：config-bar 解锁矩阵（claude/codex/pi 可切、cursor 锁 + 中性锁定文案）+ kind 过滤（engine null 全量）+ 错误卡按钮同矩阵含 provider 空 = 不拦截（`session-panel-provider-caps.test.tsx` 等既有套件扩展）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:sillyhub-daemon/src/provider-file-settings.ts | 平移 task-runner 的 applyProviderFileSettings/门槛判定/类型 + 新增 applyProviderFileSettingsForReload（分派 + 失败兜底返回 prior 文件层键，语义见接口定义） |
| 修改 | sillyhub-daemon/src/task-runner.ts | 移出上述符号，改 import 自共享模块（行为零变化） |
| 修改 | sillyhub-daemon/src/codex-settings.ts | 新增 mirrorCodexHostAuth / migrateCodexThreadFromHost 两 helper |
| 修改 | sillyhub-daemon/src/interactive/types.ts | SessionManagerDeps 增可选 daemonApiKey?: string \| null（producer=cli.ts 装配处传 daemon api_key → consumer=_reloadSessionNow / persistence restore 传给 ForReload；进程内注入不出 daemon 边界） |
| 修改 | sillyhub-daemon/src/cli.ts | SessionManager 构造 deps（:807 一带）补 daemonApiKey 注入 |
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts | _reloadSessionNow 增 codex/pi 文件层合并 + codex 迁移钩子；reloadWithProvider 删 claude-only 守卫 |
| 修改 | sillyhub-daemon/src/interactive/session-manager/persistence.ts | restore 路径对 codex/pi 同样调 ForReload 合并文件层 env（daemon 重启自愈，Grill 附带发现收编） |
| 修改 | sillyhub-daemon/src/daemon.ts | import 改共享模块（applyProviderFileSettings 从 task-runner 改指 provider-file-settings）；其余零变化 |
| 修改 | frontend/src/lib/provider-caps.ts | 导出 PROVIDER_SWITCH_ENGINES 常量（依据注释：daemon env REGISTRY ∪ 文件层） |
| 修改 | frontend/src/components/sessions/session-config-bar.tsx | providerLocked 白名单化 + 锁定文案引擎中性化；下拉按 agent_kind === 引擎过滤 |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 错误卡 timelineOnSwitchProvider 门禁白名单化（保留 provider 空前置） |
| 修改 | sillyhub-daemon/tests/daemon-provider-file-dispatch.test.ts | import 路径迁移 + ForReload 新用例 |
| 修改 | sillyhub-daemon/tests/provider-injection-smoke.integ.test.ts | import 路径迁移（:44 直引 task-runner 符号） |
| 新增 | NEW:sillyhub-daemon/tests/provider-file-settings-reload.test.ts | ForReload 分派 / mirror / 迁移矩阵单测 |
| 修改 | sillyhub-daemon/tests/daemon-provider-config-changed-handler.test.ts | reloadWithProvider 守卫删除后的热切换语义更新 |
| 修改 | sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts | REG-4「codex not yet supported」断言改写为 codex 走通（task-03 删守卫后必红，plan 审查发现） |
| 修改 | sillyhub-daemon/tests/interactive/session-manager-reload-provider.test.ts | 同款 claude-only 抛错断言改写（plan 审查发现） |
| 修改 | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx | codex providerLocked 三用例（:315/:405/:489）改写为解锁矩阵（plan 审查发现） |
| 修改 | frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx | 解锁矩阵 + kind 过滤用例 |

无对外字段/接口/DTO/payload 变更（SESSION_SWITCH_CONFIG / PROVIDER_CONFIG_CHANGED 消息形状、backend API、表结构均不动）。

## 接口定义

```ts
// sillyhub-daemon/src/provider-file-settings.ts（新增 reload 变体；spawn 版签名不变）
export interface ProviderFileSettingsReloadInput extends ProviderFileSettingsInput {
  /** reload 前会话 env 快照（取 CODEX_HOME / PI_CODING_AGENT_DIR 判「此前是否平台供应商」+ 失败兜底键来源）。restore 路径传 undefined。 */
  priorEnv: Record<string, string> | undefined;
}
/**
 * 返回值语义（与 spawn 版刻意不同，Grill P1-1 裁定）：
 * - 成功按分派产出（codex→{CODEX_HOME} / pi 自定义端点→{PI_CODING_AGENT_DIR} / pi 官方端点→{}）；
 * - codex null 切换（镜像）无论成败 → {CODEX_HOME: priorEnv.CODEX_HOME}（历史保住；镜像失败=目录留旧供应商产物=等同未切）；
 * - 写盘/IO 失败（provider 非 null）→ 返回 priorEnv 的对应文件层键（等同未切，可归因）；绝不抛。
 */
export async function applyProviderFileSettingsForReload(
  input: ProviderFileSettingsReloadInput,
): Promise<Record<string, string>>;

// sillyhub-daemon/src/codex-settings.ts
/** null 切换镜像：宿主 ~/.codex 两文件存在则拷入 codexHome，不存在则删 codexHome 同名文件。IO 失败 error 不抛（ForReload 兜底）。 */
export async function mirrorCodexHostAuth(codexHome: string): Promise<void>;
/** thread 历史迁移：宿主 ~/.codex/sessions 下 rollout 首行会话 id（payload.session_id，fixture 见 archive/2026-08-23-agent-log-conversation-view:153-158；execute 以实际首行为准兼容 session_meta.id）=== threadId 的文件按相对路径拷入 $codexHome/sessions。返回是否迁到 ≥1 文件。 */
export async function migrateCodexThreadFromHost(
  threadId: string,
  codexHome: string,
): Promise<boolean>;

// sillyhub-daemon/src/interactive/types.ts（SessionManagerDeps 增字段）
daemonApiKey?: string | null; // cli.ts 装配处注入（生产构造点 cli.ts:807）

// frontend/src/lib/provider-caps.ts
export const PROVIDER_SWITCH_ENGINES: ReadonlySet<string>; // = new Set(['claude', 'codex', 'pi'])
```

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| session switch config（会话级切换，既有） | backend | daemon | session_id, run_id, claim_token, prompt?, profile?, provider_config?（null=切回本机） | turn 边界 reload：codex/pi 新增写盘+env 合并+迁移，重启子进程，会话保持 active |
| provider config changed（默认供应商热切换，既有） | backend | daemon | session_id, provider_config（null=停用） | 空闲立即 reload / running 等 turn 边界；守卫删除后 codex/pi 与 claude 同语义 |
| session restore（daemon 重启恢复，既有） | daemon（本地） | —（不出 daemon） | state.providerConfig, state.agentSessionId | 恢复会话保持 active；codex/pi+providerConfig 非 null 新增重写目录+注文件层 env（此前不注=恢复丢供应商） |
| session end（既有，零变化） | daemon | backend | sessionId, status | 终态清理按确定性路径 rm per-session 目录（不依赖登记 Map，reload 侧新写目录天然被覆盖清理） |

## 数据模型

无 schema / 表结构 / 迁移变更。

## 兼容策略（brownfield 必填）

- **claude 零漂移**：文件层合并块仅 codex/pi 执行；claude 的 settings.json / env / transcript 迁移链路逐字不动。
- **未选供应商的 codex/pi 会话**：create 时无 CODEX_HOME → 首次切供应商触发迁移钩子；不切换则行为与现状逐字一致（reload 不写盘不注 env）。
- **daemon 重启恢复（Grill 附带发现收编）**：restore 路径此前对 codex/pi 不注文件层 env（上一变更既有缺口——恢复即静默回宿主凭证）；本变更 Wave 2 步骤 4 修复：providerConfig 非 null 的 codex/pi 会话恢复时重写目录+注 env，providerConfig null / claude 会话恢复行为逐字不变。
- **spawn 路径零变化**：`applyProviderFileSettings`（spawn 版）签名与语义不变，ForReload 仅 reload/restore 消费。
- **cursor / 未知引擎**：前端仍锁（白名单外），backend 422 校验不变，daemon 不为其注册任何注入面。
- **回退路径**：整体 revert 即回到 claude-only 门禁 + env-only reload（现状）；无数据格式/目录结构不可逆变更（per-session 目录本就存在，镜像/迁移只写平台自有目录与拷贝宿主文件，不删宿主任何东西）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | codex 迁移扫描宿主 sessions 目录大 / rollout 命名不确定 | P2 | 只读首行 session_meta（非全文件）；宿主目录不存在/无命中 warn 降级，reload 不阻断，resume 失败由 codex 真实报错收敛（对齐 claude 迁移失败降级语义） |
| R-02 | 镜像把宿主凭证拷进平台目录的暴露面 | P2 | 同机拷贝不出宿主；目录终态确定性清理 + 孤儿清扫兜底；日志永不含 api_key 明文（沿袭不泄漏铁律） |
| R-03 | 守卫删除后热切换语义升级（codex/pi 从尽力变确定性重启）与归档变更 D-009「尽力」文档口径不一致 | P1 | D-009 描述的是「不重启只重写」旧态；本变更将两路径统一为确定性 reload，daemon.ts:7713 重写降级为幂等预写——verify 时同步 _module-map / 模块卡描述 |
| R-04 | 前端白名单与 daemon 注入面漂移（未来新引擎忘解锁） | P2 | provider-caps.ts 常量注释钉死两来源（env REGISTRY ∪ 文件层），新引擎接入时同步 |
| R-05 | ForReload 写盘失败但 reload 继续重启（新进程回宿主凭证=静默切错） | P1 | 失败兜底内聚在 ForReload 返回值（Wave 1 / 接口定义）：IO 失败或 codex 门槛缺且 priorEnv 有对应键 → 返回 prior 键（行为等同未切，error 可归因）；restore 路径 priorEnv=undefined 取不到 prior 键 → 返 {}（与 create 失败语义对齐的显式降级，测试锁定）；测试锁定全分派矩阵 |
| R-06 | pi 官方端点↔自定义端点互切时 auth 优先级（文件 auth.json > env）残留旧凭证 | P2 | writePiDir 产物 auth.json 为新供应商 key；切回官方端点时丢 PI_CODING_AGENT_DIR 即丢文件 auth，env 注入接管——spike B1 已验证压制方向，测试补互切用例 |
| R-07 | UI 原型跳过（无布局/结构/流程变化，仅解锁已有组件+过滤选项——文案/可用性微调级；分级依据 brainstorm Step 5 已声明，用户当场可否决） | P2 | 记录在案 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 非 claude 引擎完整开放会话级供应商切换（含本机默认；codex 镜像保历史 / pi 回宿主） | FR-02、总体方案 Wave 1-2、R-02/R-05 | 已覆盖 |
| D-002@v1 供应商下拉按会话引擎过滤 agent_kind | FR-03、总体方案 Wave 3 | 已覆盖 |
| D-003@v1 daemon 接入点 = reload 内核统一接入（方案 A；否决 B/C） | FR-01/FR-04、总体方案 Wave 2、R-03 | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪）
- [x] frontmatter 字段齐全（author/created_at/scale=large——跨 daemon+frontend 多文件+语义决策）
- [x] 引用所有当前版本 D-xxx@vN（D-001/D-002/D-003 均入决策追踪）
- [x] 生命周期关键词（session/daemon/lifecycle）→ 已含生命周期契约表
- [x] UI 原型分级核对：跳过，原因记入 R-07（无布局/结构/流程变化）
- [x] 不确定问题：无「⚠️ 自审存疑」项；R-05 失败语义（保留旧文件层 env 而非返回空）为设计裁定，execute 时以测试锁定
