---
author: qinyi
created_at: 2026-09-13 00:37:08
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 上下文窗口用量全引擎接入 + ctx_usage 能力键统一抽象

## 背景

会话页的上下文用量环（`CtxUsageRing`，分子 `ctx_tokens` ÷ 分母窗口大小）目前**只有 Claude 会话显示真实百分比**，codex / pi / cursor 会话环显示未知态「—」。

根因不在 backend / frontend——两者对 provider 无关（`AgentRun.ctx_tokens` 列、SSE `tokens` 事件、`latestCtxTokens` 逆序取值、未知态渲染全链路已存在且引擎无关）。缺口完全在 **daemon 归一化层**：`ctx_tokens`（最近一次模型调用的提示词大小）只在两处 Claude 代码派生（`sillyhub-daemon/src/interactive/claude-events.ts:938-1021` 差分派生、`sillyhub-daemon/src/interactive/claude-sdk-driver.ts:696-697` SDK 透传）；codex / pi / cursor 的解析器都产出了四维 token（input / output / cache_read / cache_creation），但都不派生 ctx 维度。

数据其实都在（调研实证）：

- **pi**：`turn_end.message.usage`（`{input, output, cacheRead, cacheWrite}`）。pi-ai 官方库源码实证（本机 pi 0.81.1）——Anthropic 系 provider 直映 `input_tokens→input`（净值，`totalTokens = input+output+cacheRead+cacheWrite`）；openai-completions 系 `input = prompt_tokens − cacheRead − cacheWrite`（同样净值）。且 pi 的 agent turn = 单次 LLM 调用（`turn_end.message` 即该调用产出的 assistant 消息），turn_end.usage 即**该次调用的终值快照**。
- **cursor**：`result` 帧 `usage`（camelCase 四维）。fixture 跨轮连续性验证净值口径：turn1 `6578+8704=15282`（turn1 全上下文）→ turn2 `186+15232=15418`（15282 + 轮间增量 ≈ 吻合）。`sillyhub-daemon/src/interactive/cursor-events.ts:40` 旧注释「cursor 侧无 ctx 维度，ctx_tokens 缺省」是当时未派生的决策记录，非数据缺失。
- **codex**：`thread/tokenUsage/updated` 通知（`_extractTokenUsage`，sillyhub-daemon/src/interactive/codex-app-server-driver.ts:1399-1466，注释实测 codex 0.147）：`total` 为**线程累计**（inputTokens 为含 cached/cacheWrite 的毛值，实测 `totalTokens = inputTokens + outputTokens`）；`last` 为**单调用**——单调用毛值 input 恰为该次调用的全提示词大小。现行代码只解析 `total`。
- **claude**（参照实现，不动）：`ctx = input_tokens + cache_read + cache_creation`，仅 main 桶；`usage_update` 的轮级 `input_tokens` 是**本轮累计**（Σ 逐调用），证明消费侧无法从轮累计反推单调用 ctx——这正是 2026-08-27-session-token-usage-fix 修掉的「环永远封顶 100%」缺陷的物理根源。

契约与抽象设施也已就位但被「祖父豁免」：`sillyhub-daemon/src/agent-event-schema.ts:52` 的 `ctx_tokens` 可选键、backend `backend/app/modules/daemon/run_sync/service/submit_steps.py:357-361` 提取、`docs/agent-provider-onboarding.md` usage 五字段短名契约（D-005@v1 含 ctx_tokens）都已存在；但 codex / pi / cursor 是契约定稿前接入的，从未回填。防遗漏抽象（2026-09-11-provider-adapter-registry：`INTERACTIVE_PROVIDERS` satisfies TS2741 强制 + `gen-provider-caps.mjs` 三端生成 + 双守护测试）没有 ctx 用量这一能力键，新引擎接入时「漏派生 ctx」不会被任何机制拦截。

## 设计目标

- **FR-01（pi 接入）**：pi 会话环显示真实百分比——`pi-events.ts` 在 turn_end usage 快照事件中派生 `ctx_tokens = input + cacheRead + cacheWrite`。
- **FR-02（cursor 接入）**：cursor 会话环显示真实百分比——`cursor-events.ts` 的 `mapUsage` 派生同式 `ctx_tokens`；修正 :40 旧注释。
- **FR-03（codex 接入）**：codex 会话环显示真实百分比——`codex-app-server-driver.ts` 的 `_extractTokenUsage` 解析通知中的 `last`，`ctx_tokens = last.inputTokens`（毛值直取）；usage_update 事件与 turn result 两路都携带。
- **FR-04（统一抽象）**：ProviderCaps 新增第 11 键 `ctx_usage: boolean`（interactive 会话是否上报 ctx_tokens），四引擎全 true；经 `gen-provider-caps.mjs` 三端生成（daemon 单源 → frontend `provider-caps.ts` + backend `provider_caps.py`），双守护测试（`test_provider_caps_alignment.py` 的 `EXPECTED_CAPS_KEYS` + `provider-registry.test.ts` 契约键清单）同步加键——**新引擎漏声明即编译红/测试红**。
- **FR-05（派生公式单源）**：净值三和派生抽为共享 helper（claude / pi / cursor 同式复用），codex 毛值直取单独成函数并在两处注释锚定口径差异；口径永远一处定义。
- **FR-06（前端门控）**：`CtxUsageBar` 按 `getProviderCaps(provider).ctx_usage` 门控环渲染——false 只渲染 QuotaPill 不渲染环（防未来不支持引擎永远「—」误导）。当前四引擎全 true，用户界面零变化。
- **FR-07（真机验证）**：execute 阶段真机跑 codex 会话验证 `last` 字段形态与取值（唯一未实证点）；pi / cursor 用 fixture 断言 + 真机冒烟复核。

## 非目标

- **NG-01**：不改 Claude 既有派生口径与 main 桶限定（参照实现原样保留，仅重构为引用共享 helper）。
- **NG-02**：不做后端聚合列 / 历史数据迁移（项目未上线惯例；历史 run `ctx_tokens=NULL` 保持未知态「—」，与 2026-08-27 NG-04 同口径）。
- **NG-03**：gemini 不在范围——非 interactive 引擎（批量任务模式无会话环）；未来接入 interactive 层时 `satisfies` 联合扩员即编译强制其声明 `ctx_usage`（防遗漏机制天然覆盖）。
- **NG-04**：不动 budget / 会话累计台账（D-009 口径 input+output 不含 cache）、不动 `_liftSessionUsage` replace 语义、不动轮级计费量上报口径。
- **NG-05**：不改环组件视觉 / 阈值 / 浮层交互（2026-08-27 NG-05 延续）；`ctx_window_tokens` 分母四级链不动。
- **NG-06**：不接入批量层 protocol adapter（`adapters/index.ts` 六协议）——任务模式无环展示，usage 累计口径照旧。

## 拆分判断

daemon（三解析器 + caps 单源 + 生成脚本）→ 生成产物（frontend / backend）→ frontend（门控消费）是同一条能力声明链，加一半就是断链（caps 键加了前端不消费=死元数据；前端门控了键没生成=编译红）；三解析器回填互相独立但共用 helper 与守护测试。单变更一次贯通，走 large 四件套。

## 总体方案

### Wave A — daemon 派生回填（FR-01/02/03/05）

**共享 helper（新增 `sillyhub-daemon/src/interactive/usage-ctx.ts`）**：

```ts
/** 净值口径派生（claude / pi / cursor）：input 为未命中缓存的净输入。 */
export function ctxTokensFromNetInput(
  input: number | undefined,
  cacheRead: number | undefined,
  cacheCreation: number | undefined,
): number | undefined;

/** 毛值口径派生（codex）：grossInput 已含 cached + cacheWrite。 */
export function ctxTokensFromGrossInput(
  grossInput: number | undefined,
): number | undefined;
```

语义：三分量（或毛值）**全缺 → undefined**（不伪造 0，事件不含 ctx_tokens 键 → 消费侧缺键即跳过，与 claude 子桶同契约）；任一分量缺失按 0 计（有部分数据即派生，与 claude `startInput ?? 0` 同口径）。**pi 口径特记（Grill D-1）**：pi 路径 `numOr0` 归一使三入参恒为 number，全缺分支恒不触发——错误轮全零 usage（sillyhub-daemon/src/interactive/pi-events.ts:417?「全零——错误轮的用量事实」）将携带 `ctx_tokens=0`，环显示 0.0% 而非未知态。这是**有意的口径**：全零是该轮真实用量事实（pi 归一化器原样上报哲学），与 claude「事件缺键」的未知态语义并列成立；cursor / codex 路径走 undefined 分支不受影响。

1. **pi-events.ts `buildUsageEvent`**（:519-532）：映射处加 `ctx_tokens = ctxTokensFromNetInput(input, cacheRead, cacheWrite)`——`numOr0` 已保证 number，直接算；`usage` 一等字段与 `metadata.usage` 两处同源注入。
2. **cursor-events.ts `mapUsage`**（:315-332）：四对映射后加 ctx 派生（任一有效字段存在即算）；usage 挂载点（result 帧 → `ev.usage`，:296-299）无需改——mapUsage 返回值带上即透传。同步修正 :37-40 头注释「cursor 侧无 ctx 维度」→「ctx_tokens = inputTokens + cacheReadTokens + cacheWriteTokens 净值三和（fixture 跨轮连续性验证）」。
3. **codex-app-server-driver.ts `_extractTokenUsage`**（:1407-1466）：解析扩展 `params.tokenUsage.last`；存 `h.lastCallCtxTokens = ctxTokensFromGrossInput(last.inputTokens)`；`_usageDelta` 返回的 usage（usage_update 事件载体）与 `_applyTurnUsageDelta` 填充的 turn result usage 都附加 `ctx_tokens`。`last` 缺失 / 非法 → 不携带（该引擎 ctx 保持未知态，不伪造）。
4. **claude-events.ts 重构引用 helper**（:946 三分量求和处改调 `ctxTokensFromNetInput`）：行为零变化（公式同式），口径单源。差分路径（:1007-1008 `ctx − prevCr − prevCc + newCr + newCc`）维持原样——增量维护公式无法直接复用三和 helper，注释锚定共享 helper 保持不变式。

**数据流（全链路既有，零新增跳数）**：normalizer 产 `AgentEvent.usage.ctx_tokens`（schema `sillyhub-daemon/src/agent-event-schema.ts:52` 已有可选键）→ `SessionManager._eventToReportDict` 平铺 dict 顶层 → daemon submit → backend `backend/app/modules/daemon/run_sync/service/submit_steps.py:357-361` 提取 → `AgentRun.ctx_tokens` last-write-wins（`backend/app/modules/daemon/run_sync/service/submit_commit.py:187-193`）→ SSE run summary + session `tokens` 事件（`backend/app/modules/daemon/run_sync/service/publish.py:140-143/:216-220`）→ 前端 `onTokens`/`runsMeta` 回填 turn.ctxTokens → `latestCtxTokens` 逆序首个非 null → 环分子。

### Wave B — caps 第 11 键三端贯通（FR-04）

1. `providers.ts`：`ProviderCaps` 接口加 `ctx_usage: boolean`（注释注明第 11 键 + 取值依据锚点）；`PROVIDER_CAPS` 四引擎全 true；`getProviderCaps` 未知回退加 `ctx_usage: false`。
2. `gen-provider-caps.mjs`：`CAPS_KEYS` 加 `ctx_usage`；`renderFrontend` 模板回退字面量同步（backend 回退程序化派生自 `_CAPS_KEYS` 无需改模板）。**三处硬编码同步点（Grill X-d）**：① `renderFrontend` 模板内硬编码的 ProviderCaps 接口体（:218-246，漏加则生成的前端表带 excess property 编译红）；② 两端模板多处「10 键：9 个 boolean」文案同步 11 键；③ `test_provider_caps_alignment.py` 两处 `len == 10` 硬断言（:148/:195）同步 11。漏改均为编译红/断言红的响亮失败，非静默债务。
3. 跑生成（`node sillyhub-daemon/scripts/gen-provider-caps.mjs` 或 frontend `pnpm gen:types` 链尾）：刷新 `frontend/src/lib/provider-caps.ts` + `backend/app/modules/agent/provider_caps.py` 两份 @generated 产物。
4. 守护测试同步：`test_provider_caps_alignment.py` `EXPECTED_CAPS_KEYS`（:40）加键；`provider-registry.test.ts` 契约键清单（`tenKeys` → 11 键）加键并更名断言描述。

### Wave C — frontend 门控（FR-06）

`ctx-usage-bar.tsx`：`CtxUsageBarProps` 加 `provider?: string | null`；组件内 `provider != null && !getProviderCaps(provider).ctx_usage` → 只渲染 `QuotaPill`（环不渲染）；调用方（全仓仅 `frontend/src/components/daemon/session-panel/session-panel-page.tsx:2727?/:3501` 两处，Grill X-c 核实）传 provider。provider 未知 / null（本机默认供应商等）→ 维持现状渲染环（未知引擎不因门控丢功能，环仍有未知态兜底）。

### Wave D — 验证（FR-07）

1. 真机 codex 会话（本机 codex-cli 0.147.0 在装）跑一轮对话，抓 `thread/tokenUsage/updated` 原始通知确认 `last` 形态与 `last.inputTokens ≈ 当前上下文大小`；结论写入 QUICKLOG。
2. daemon vitest：三解析器新 fixture / 既有 fixture 扩断言（ctx_tokens 值 + 缺字段不伪造）；caps 守护两套件绿。
3. frontend vitest：门控分支（false 不渲染环 / true 照常 / provider null 照常）。
4. backend：无逻辑改动，alignment 守护测试绿即可。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:sillyhub-daemon/src/interactive/usage-ctx.ts | 共享派生 helper：`ctxTokensFromNetInput`（净值三和，claude/pi/cursor）+ `ctxTokensFromGrossInput`（毛值直取，codex）；全缺 → undefined 不伪造 |
| 修改 | sillyhub-daemon/src/interactive/pi-events.ts | `buildUsageEvent` 派生 ctx_tokens（FR-01）；头注释映射表补 ctx 行 |
| 修改 | sillyhub-daemon/src/interactive/cursor-events.ts | `mapUsage` 派生 ctx_tokens（FR-02）；修正 :37-40「无 ctx 维度」旧注释 |
| 修改 | sillyhub-daemon/src/interactive/codex-app-server-driver.ts | `_extractTokenUsage` 解析 `last` + 存 lastCallCtxTokens；`_usageDelta` / `_applyTurnUsageDelta` 两路 usage 附加 ctx_tokens（FR-03） |
| 修改 | sillyhub-daemon/src/interactive/claude-events.ts | :946 三分量求和改调共享 helper（FR-05，行为零变化）；差分路径注释锚定 |
| 修改 | sillyhub-daemon/src/interactive/providers.ts | ProviderCaps 加 `ctx_usage` 第 11 键 + PROVIDER_CAPS 四引擎 true + getProviderCaps 回退 false（FR-04） |
| 修改 | sillyhub-daemon/scripts/gen-provider-caps.mjs | CAPS_KEYS + renderFrontend 回退模板加键（FR-04） |
| 修改 | frontend/src/lib/provider-caps.ts | @generated 产物刷新（gen 脚本产出，ctx_usage 键 + 回退 false） |
| 修改 | backend/app/modules/agent/provider_caps.py | @generated 产物刷新（同上，backend 回退程序化派生） |
| 修改 | backend/app/modules/agent/tests/test_provider_caps_alignment.py | EXPECTED_CAPS_KEYS 加 ctx_usage + 两处 len==10 断言同步 11（守护同步） |
| 修改 | frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx | 两处 10 键全对象 toEqual 加 ctx_usage（cursor=true / unknown-engine 回退=false）+「十键」标题同步（plan-review P1 连带测试，11 键产物后必红） |
| 修改 | sillyhub-daemon/tests/interactive/provider-registry.test.ts | 契约键清单 10→11 加 ctx_usage（守护同步） |
| 修改 | sillyhub-daemon/tests/provider-adapter-registry.test.ts | 三处「caps 10 键」过时注释顺手同步（P2，非断言） |
| 修改 | frontend/src/components/sessions/ctx-usage-bar.tsx | CtxUsageBar 加 provider prop + caps 门控（FR-06；false 只渲染 QuotaPill） |
| 修改 | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | 门控三分支 vitest（虚构 provider 命中未知回退 false / 现有引擎 true 照常 / 不传 provider 照常） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 两处 CtxUsageBar 调用传 provider（:2709 用 preEngine、:3501 用 session.provider；Grill X-c 核实为全仓仅有的两个调用点，sessions-portal/floating-session-host 仅注释提及不渲染该组件） |
| 修改 | docs/agent-provider-onboarding.md | usage 契约节补两种派生口径说明（净值三和 / 毛值直取）+ caps 第 11 键登记指引 |
| 新增 | NEW:sillyhub-daemon/tests/interactive/usage-ctx.test.ts | helper 纯函数单测（全缺→undefined / 部分缺按 0 / 三和 / 毛值直取四类分支） |
| 修改 | sillyhub-daemon/tests/interactive/pi-events.test.ts | 3 处全对象 toEqual 加 ctx_tokens（fixture manual-success-turn 末次调用 ctx=1800 / 全零 ctx=0 / 守卫用例）+ fixture 断言（fixture 本身不改——manual-success-turn 已含非零 usage 样本，Grill X-a-2 核实） |
| 修改 | sillyhub-daemon/tests/interactive/cursor-events.test.ts | 5 处精确 usage toEqual 加 ctx_tokens（turn1/turn2/probe fixture 数值 :140/:188/:238/:312/:371）+ 全缺不携带守卫（:501 零改动即通过；fixture 本身不改） |
| 修改 | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | tokenUsageNotif 已建模 last（:235）多用例断言 ctx_tokens + 新增无 last 反断言（fixture 文件不动，通知样本内联） |

**字段数据流标注**（ctx_tokens 既有链路复述 + 新增 producer）：producer=各归一化器（pi `buildUsageEvent` / cursor `mapUsage` / codex `_usageDelta`，本次新增）与 claude 既有两源 → `AgentEvent.usage.ctx_tokens`（schema 既有可选键，无序列化改动）→ `SessionManager._eventToReportDict` 平铺 dict 顶层（既有）→ backend `submit_steps` 提取（既有 :357-361）→ `AgentRun.ctx_tokens` last-write-wins（既有列，无迁移）→ SSE summary / tokens 事件（既有）→ 前端 turn.ctxTokens → `latestCtxTokens`（既有）→ 环分子。**caps `ctx_usage` 键数据流**：producer=`providers.ts` PROVIDER_CAPS（单源）→ `gen-provider-caps.mjs` 解析渲染 → consumer=frontend `provider-caps.ts`（CtxUsageBar 门控）+ backend `provider_caps.py`（对账守护消费，无业务逻辑门控点）。

## 接口定义

```ts
// sillyhub-daemon/src/interactive/usage-ctx.ts（新增）
export function ctxTokensFromNetInput(
  input: number | undefined,
  cacheRead: number | undefined,
  cacheCreation: number | undefined,
): number | undefined;
export function ctxTokensFromGrossInput(
  grossInput: number | undefined,
): number | undefined;

// providers.ts ProviderCaps 追加（第 11 键）
export interface ProviderCaps {
  // …既有 10 键…
  /** interactive 会话是否上报上下文窗口用量分子（ctx_tokens）。 */
  ctx_usage: boolean;
}

// frontend ctx-usage-bar.tsx CtxUsageBarProps 追加
export interface CtxUsageBarProps extends CtxUsageRingProps {
  providerId?: string | null;
  /** 会话引擎名（INTERACTIVE_PROVIDERS 键）；caps.ctx_usage=false 不渲染环。null/未知照常渲染。 */
  provider?: string | null;
}
```

## 生命周期契约表

生命周期契约：无/N/A（本变更不新增/修改任何 session / lease / agent_run 状态迁移事件——ctx_tokens 与 ctx_usage 均为既有链路上的数据维度扩展，usage 事件载体、run 状态机、claim/heartbeat 语义零变化）。

## 数据模型

无 schema 变更（`AgentRun.ctx_tokens` 列 2026-08-27 已建；caps 键为内存常量表 + 生成产物，无存储）。

## 兼容策略（brownfield 必填）

- **旧 daemon / 历史数据**：`ctx_tokens` 缺失链路行为不变——事件缺键即跳过（backend :357-361 既有守卫）、历史 run NULL → 环未知态「—」（现状渲染分支）。
- **caps 门控回退**：provider 未知 / null → 照常渲染环（不因门控丢现有功能）；`getProviderCaps` 未知引擎回退 `ctx_usage: false` 与既有「缺省默认拒绝」铁律一致，但环的 provider=null 旁路保证本机默认供应商等场景不回归。
- **codex `last` 缺失**：不携带 ctx_tokens → 该引擎环保持未知态（不伪造 0），四维 token 照旧上报——纯降级无破坏。
- **不改变的 API / 表结构**：REST DTO 零变化（无 `pnpm gen:types` 必要性——provider-caps.ts 由 gen-provider-caps.mjs 独立产出不经 OpenAPI 链）；手写 SSE envelope 类型既有 `ctx_tokens` 字段不动。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | codex `last` 字段形态未实证（仅 daemon 注释实测记录，0.147 二进制无源码可查） | P1 | Wave D 首任务真机抓通知验证；缺失则 codex 保持未知态如实降级（NG 边界内），设计不依赖该字段存在 |
| R-02 | pi turn_end usage 单调用语义——Grill X-a-2 已获 fixture 强证据（manual-success-turn.jsonl 第 9/18/19 行：两调用轮的 turn_end.usage 与末次 message_end.usage 逐字段相同，非累计求和），风险低于初评 | P2 | 保留 execute 真机复核（多工具调用轮 + 换 provider 场景）；若意外为轮累计则 pi 降级为「不携带 ctx」并如实翻 caps（宁可 unknown 不造假） |
| R-03 | claude-events 重构（改调共享 helper）引入行为漂移 | P2 | 行为零变化约束 + 既有 claude vitest 全绿兜底（claude-events 测试覆盖 ctx 派生链） |
| R-04 | caps 生成脚本解析器只认 boolean/三值字符串——ctx_usage 为 boolean 无需扩展解析器，但未来若有数值型能力键会踩坑（既有债务非本次引入） | P2 | 不在本次范围；onboarding 文档补登记指引时顺带注明解析器限制 |
| R-05 | 前端门控误伤现有引擎（caps 拼写/生成失败导致 false） | P2 | 生成脚本响亮失败守卫（解析不完整不写产物）+ 守护测试三端对账；四引擎全 true 断言 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | FR-04/FR-05（Wave B caps 键 + Wave A 共享 helper）；Wave A 派生位置；B/C 否决理由=风险登记 R-02 关联（轮累计 input 不可消费侧反推） | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字块齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@v1
- [x] 生命周期关键词命中（session/daemon/agent_run）→ 已写紧邻豁免短语「生命周期契约：无/N/A」+ 括注说明（零状态迁移）
- [x] UI 原型分级核对：跳过——纯防御性门控，四现有引擎界面行为零变化，无布局/组件/流程改动（分级「跳过」档：无界面变化；用户已在 step 5 确认）
- [x] ⚠️ 自审存疑两点已升 R-01 / R-02（codex last 形态、pi turn_end 单调用 vs 轮累计），均配真机验证或如实降级路径，不阻塞设计成立
