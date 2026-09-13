---
author: qinyi
created_at: 2026-09-12T23:55:00
---

# 设计 — 2026-09-12-session-live-display-fixes

> 会话直播展示保真五修复：直播碎片气泡（R1）、失败卡伪 code:116（R2）、纯切换轮空 user_input/turn_count 虚高（R3）、运行中轮计时锚点漂移（R4）、自动续跑链到上限无感知（R5）。
> 诊断证据链：会话 `d4c29d95-755f-4eec-883a-5f1b9c42bb7d`（阿里云生产库实测，2026-09-12）；R5 源于当日 15:11 chain-limit 停跑实证（`auto_recover_nudge_chain_limit` chain=2）。

## 0. 背景与根因（诊断结论，已用户确认）

### R1 直播碎片气泡（刷新恢复）

**现象**：直播中每条 assistant 回复开头几个字成独立小气泡（实测 `apply`/`上一`/`新`/`check`），紧跟完整气泡；刷新后小气泡消失。

**链路**：daemon pi 引擎流式输出（`sillyhub-daemon/src/interactive/pi-events.ts`）→ 消息形态固定 `[thinking(ci0), text(ci1)]`，partial 增量窗口（500ms 节流，`segment_id=pi:msg<N>:ci<C>`）先到，`message_end` 产 override 完整事件；backend `_persist_agent_event` 展开为 `[ASSISTANT] <全文>` 行（SSE envelope `segment_id=None`），并在完整行落库点（quick-0e56260f）**合成撤回令箭** `[ASSISTANT_OVERRIDE] <segmentId>`（envelope `stale=true, segment_id=<seg>`）+ DELETE 同 segment partial 行。SSE 到达序实测固定：`[THINKING] → [ASSISTANT_OVERRIDE] → [ASSISTANT] 全文`（同毫秒三行，run a4242e2a 15:00:05.699 实证）。

**双防线失效点**（`frontend/src/components/daemon/session-log-assembler.ts`）：

1. `revokePartialSegments`（~L955-987）：按 segmentId 首冒号前缀路由撤回桶——`main:` → 顶层；其他前缀按工具容器 id 找 `treeContainsContainerWithId`，找不到 `return null` 静默 no-op。**pi 的 `pi:msg<N>:ci<C>` 前缀 `pi` 永远找不到容器 → 令箭撤回恒无效**。backend 注释声明的协议语义是「前端据令箭按段 id **任意位置**撤回乱序胶水段（不依赖前缀判定）」——实现从未达到该语义（为 Claude `main:`/`<tool_use_id>:` 形态写的路由，pi 接入时漏适配）。
2. `dropPrefixPartialReply`（~L1583-1603）：完整回复行到达时只检查桶**尾**单个 text partial 是否 fullText 前缀。pi 消息的 `[THINKING]` 行先于全文行到达，把 text partial 从尾位挤开 → 前缀收编失效。

**为何刷新正常**：backend 完整行落库时已 DELETE partial 行（`_revoke_committed_partials`），历史回放只有干净行——纯前端实时渲染 bug，DB 数据无恙。

### R2 失败卡伪 code:116

`agent_runs.error_detail = {type: provider_error, code: "116", message: 供应商服务异常, raw: "[silent stream truncation] ...（api_calls=116, final_text=y）"}`。`sillyhub-daemon/src/model-error/classifier.ts` `extractCode` 第 3 兜底 `\b([1-5]\d{2})\b`（裸三位数字当 HTTP 码）从 `api_calls=116` 误抓 116——116 是本轮 API 调用次数，不是任何错误码。用户被误导以为供应商返回 116 错误。

### R3 纯切换轮空 user_input / turn_count 虚高

`backend/app/modules/daemon/session/service/inject.py` `_inject_into_session`：user_input AgentRunLog **无条件落库**（L668-686）+ `turn_count += 1`（L637），随后才有静默切换分支把 run 落终态 completed——其上方注释（ql-20260817-010）声称「纯配置变更记录，无 user_input 日志 → 时间线不渲染」，**注释与实现矛盾**。实测该会话 30 轮中 12 轮为纯切换轮（智谱 GLM ↔ GLM-wp 来回切），轮次导航/会话列表「30 轮」虚高。

### R4 运行中轮计时锚点漂移

`frontend/src/components/daemon/session-panel/page-helpers.tsx` `enrichDisplayTurns`：`turnStartedAt: t.turnStartedAt ?? parseRunStartedAt(meta.started_at)` —— ?? 链让本地值永远压过快照值。attach 时运行中轮的本地锚点来自**日志窗口首行时间戳**（`logsToTurns` 的 `firstLogTimestampMs`，`limit=100` 窗口对千行 run 只覆盖尾部），重连 initialSync 重建时窗口滑动 → 锚点跟着走。实测两次观察间隔 11 分钟、elapsed 只涨 46 秒（05:41→06:27），锚点后移 10 分钟。

## 1. 决策/方案选择（D-001~D-004，选定方案 A：前端按既有协议语义修复，零协议变更；否决方案 B/C 及 R2 纯删除变体见 decisions.md）

### R1.1 revokePartialSegments 全树扫描撤回

改前：前缀路由——`main:` → 顶层段；其他前缀按工具容器 id 找 `treeContainsContainerWithId`，找不到 `return null` 静默 no-op。
改后：全树 DFS，凡 `derivesFromSegmentId(s.id, kind, segmentId)` 命中的同类段（含任意嵌套容器 children 内，深度>1 同样覆盖——顺带修复现状「容器只撤直接 children」的缺口）一律移除；`removedIds` 登记保持（F7 投影重算消费）；实现沿 `applyToBucket` 既有 path-copy 不可变风格重建（filter 回调内重赋值的伪代码草图不可用）。`main:`/工具容器前缀特判**删除**（全树扫描是两者的语义超集，保留特判反增分支）。

安全性：段 id 由 `segmentIdBase` 派生（`<kind>:<segmentId>` + 唯一后缀），同 segmentId 派生段只属同一流式源，实践不撞（pi/claude/codex segmentId 均含冒号、序号在尾段，与 `-2/-3` 唯一后缀规则不冲突；§6 存疑 1 的防御用例仍加）；thinking/text 由 variant 区分。
- 既有测试（override 撤回系列）语义不变，仅不再依赖前缀路由命中。

### R1.2 dropPrefixPartialReply 全桶前缀收编

改前：只处理桶尾单个 text partial（`last.segId != null && fullText.startsWith(last.text)` → 移除 + seal）。
改后：`applyToBucket` 内扫描**全部** children——凡 `kind==="text" && segId != null && fullText.startsWith(text)` 者移除，逐个 seal 其 segId。多 text part 消息（ci0/ci1 交错段）与多窗口乱序同样收敛；非前缀（丢窗口胶水段/内容分叉）保留，由 R1.1 令箭撤回兜底。两道防线互补：前缀判定治愈有序流，令箭撤回治愈乱序流。

**F7 增量投影硬约束（审查 P1-1）**：中位（非尾位）text partial 被移除后，若完整行随后 merge 进桶尾 segId-null text 段且 `mergedInto.id === prevCell.lastTextSegId`，O(1) 增量路径（`prevCell.output + seg.text`）仍含已删 partial 文本——违反 F7「cell 值恒等于 segmentsToLegacy(segments)」不变量，恰复现本变更要修的重复碎片症状（触发序 `[partialB(s1), fullX] + fullB`，迟到/乱序 partial 生产已实证）。约束：**凡 dropPrefixPartialReply 实际移除了段（含中位），调用方必须使该 turn 的 F7 cell 失效**（lastTextSegId/lastItemSegId 锚点置 null → 下次走全量重投影）；§4 加「增量投影与全量重投影对拍」用例锁定。现状尾位-only 移除结构性免疫（被删段即锚点段），全桶扫描打破了该保证，必须同步收口。

### R2 extractCode 收紧 + 静默断流专属文案（D-003）

- `extractCode` 第 3 兜底的裸三位数字分支 `\b([1-5]\d{2})\b` **替换**为原因短语锚定分支 `\b(\d{3})\s+[A-Z][a-z]`（3 位数字 + 空白 + 大写开头词，即 HTTP reason phrase 形态）；保留既有四种上下文锚定：`(ddd)` / `HTTP[\s/]*ddd` / `status[^\d]{0,3}ddd` / `http[^\d]{0,3}ddd`。`api_calls=116, final_text=y`（逗号紧跟、无大写词）不再出码；既有用例 `'401 Unauthorized: invalid api key'` / `'502 Bad Gateway'`（`classifier.test.ts:89-99, 177-186`）经新分支继续出码 401/502，**断言不变、零测试破坏**。
- `classifyModelError`：blob 含 `[silent stream truncation]` 签名时 message/hint 覆写为「上游输出流中断，本轮未产生收尾回复」/「上游输出流中断，已支持自动续跑；若未自动续跑可重试或切换供应商」；`type` 维持关键词分类结果（通常 provider_error）——**零错误分类学变更**（backend `auto_resume.py TRANSIENT_ERROR_TYPES` 依赖不动）；code 经收紧后对该 blob 天然 null。

### R3 纯切换轮跳过 user_input / turn_count（D-002）

`_inject_into_session`：**复用既有局部变量 `silent_config_switch`**（`inject.py:596` 已存在 `config_switch and not prompt.strip()` 判定，mission 双标记豁免在消费；终态分支 `:709-711` 是第二处重复判定——本变更一并收口到该变量，不新增第三个同名变量）：
- `silent_config_switch` 时跳过 user_input AgentRunLog 构造与 `svc._session.add`；
- `session.turn_count` 递增与 user_input 写入同段收口为 `if not silent_config_switch`；
- `session.last_active_at = now` 照刷（活动真实）；run 照建（前端紧凑配置行 ql-20260818-011 + runsMeta 孤儿轮补建依赖 run 存在）；终态分支判定改用同一变量。
- 同型路径口径（审查 P2 修正）：queue 派发与定时消息**创建时**均要求非空 prompt（`scheduled_messages.py:112-118` 校验），但 queue 条目经 `inject.py:131-137` 空判豁免入口可持空 prompt + 切换字段入队，派发（`queue.py:707-727`）回落共享核心——即 queue 派发的空 prompt 轮**必为切换轮**，恰由本修复在共享核心覆盖，无需改 queue。
- 存量空行不迁移（项目未上线；前端已把空轮渲染为紧凑配置行，无用户可见危害）。

### R4 运行中轮计时锚点优先 run 快照

`enrichDisplayTurns.enrichOne`：当 `meta.status` ∈ {`running`, `pending`, `pending_approval`}（活跃词表全集，`model.py:42`；team 审批轮可达 `pending_approval`）且 `parseRunStartedAt(meta.started_at)` 非 null 时，`turnStartedAt` **强制取快照值**（覆盖本地窗口派生锚点/Date.now 占位；`pending` 轮 started_at 常为 null → 不覆盖，天然安全）；终态轮维持 `??` 链现状（历史轮无实时计时语义，快照缺失时本地值兜底）。身份稳定守卫（引用比对）不变。

### R5 自动续跑链到上限后用户无感知（新增，体验，D-004）

**现象（本日 15:11 实证）**：会话 d4c29d95 续跑链第 2 次被上游静默断流打断，backend `auto_recover_nudge_chain_limit`（chain=2 ≥ AUTO_RESUME_MAX_CHAIN）静默停跑交回用户——用户只见「供应商异常」失败卡，不知道**为什么不再自动续了、需要手动做什么**，体验断层。

**修复**：`auto_resume.py` chain-limit 分支不再纯静默——对刚终态的 run 补写 `error_detail` 提示：hint 覆写为「上游连续中断，自动续跑已达上限（2 次）；请手动发送继续接续，或切换供应商后重发」，并加 `error_detail.auto_resume_stopped = true` 标记（前端失败卡已渲染 hint，零前端改动即可呈现；type/code/raw 保持原值不动，不影响 auto-recovery 判定与既有断言）。写入走既有 svc._session 短事务，失败仅 warn（维持「全程静默容错不影响已 commit 终态」原则）。

## 1.5 生命周期契约表

本变更不新增生命周期事件/状态，只改动既有状态内的写入与消费；涉及面契约如下：

| 事件/状态变化 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 纯切换轮 run 创建即终态 | backend `_inject_into_session` | AgentRun/AgentSession | `silent_config_switch`（局部单源）：跳过 user_input 行、turn_count 不增 | run: pending→completed（同事务）；session: last_active_at 刷新，turn_count 不变 |
| 续跑链上限停跑 | backend `maybe_auto_recover_failed_turn`（run 终态 post-commit 钩子） | AgentRun.error_detail | chain ≥ AUTO_RESUME_MAX_CHAIN 时覆写 hint + `auto_resume_stopped: true` | run 状态不变（已 failed）；仅 error_detail 增量写 |
| override 撤回令箭（SSE） | backend 合成（quick-0e56260f，随完整行同批 publish） | 前端直播装配器 | envelope `stale=true` + `segment_id`（任意前缀形态） | 前端 turn 段树：该 segmentId 派生段移除（全树）；无容器/前缀要求 |
| 完整回复行（SSE） | backend `_persist_agent_event` | 前端直播装配器 | envelope `segment_id=None` + 全文 | 桶内前缀 partial 段收编移除 + F7 cell 失效（如实际移除） |

## 2. 文件变更清单

| 文件 | 变更 | 类型 |
|---|---|---|
| `frontend/src/components/daemon/session-log-assembler.ts` | revokePartialSegments 全树扫描；dropPrefixPartialReply 全桶扫描 + 移除即失效 F7 cell | R1 |
| `frontend/src/components/daemon/session-panel/page-helpers.tsx` | enrichOne 运行中轮锚点优先快照（含 pending_approval） | R4 |
| `sillyhub-daemon/src/model-error/classifier.ts` | extractCode 裸数字分支→原因短语锚定；truncation 签名专属文案 | R2 |
| `backend/app/modules/daemon/session/service/inject.py` | silent_config_switch 复用收口：跳过 user_input/turn_count + 终态分支统一 | R3 |
| `backend/app/modules/daemon/session/service/auto_resume.py` | chain-limit 分支补写 error_detail hint + auto_resume_stopped 标记 | R5 |
| 对应测试文件（见 §4） | 新增/调整用例 | — |

## 3. 非目标（Non-Goals）

- 不改 daemon segmentId 协议格式（D-001 否决方案 B）。
- 不动错误分类学（type 枚举、TRANSIENT_ERROR_TYPES、auto-recovery 判定序）。
- 不迁移存量空 user_input 行 / 不回填存量 turn_count。
- 不做 dialog 模式切换轮 whoLine 注入（低价值，另行观察）。
- 不修「任务统计 201/198/0 不闭合」「会话 ended_at 残留」两个次要观察（另行评估）。
- R5 仅覆盖续跑 nudge 链上限（TRANSIENT 分支）；quota 链上限（QUOTA_CHAIN_LIMIT=3，额度场景本身有 reset_at 提示）不并入，另行评估。

## 4. 测试设计（只跑相关面，禁全量）

- **frontend**（`pnpm test` session-log-assembler / runtime-session-helpers / page-helpers 相关文件）：
  - revoke：pi 前缀 segmentId 的 text partial 段（顶层 + 工具桶内嵌套）收到 override 令箭后全被移除（改前复现 no-op）；Claude `main:` 前缀与工具桶撤回用例不回归；
  - 收编：桶尾被 thinking 段隔开时 fullText 前缀 partial 仍被收编（pi 三行序 THINKING→OVERRIDE→ASSISTANT 集成用例：直播装配产物 == 历史装配产物）；
  - **F7 对拍**（审查 P1-1）：中位 partial 被收编后，增量投影 output == segmentsToLegacy 全量重投影（触发序 `[partialB(s1), fullX] + fullB`）；
  - derivesFromSegmentId 唯一后缀理论歧义防御用例（§6 存疑 1）；
  - 锚点：running/pending_approval 轮 + runsMeta 有 started_at → 计时锚点取快照；终态轮不回归。
- **daemon**（`pnpm test` model-error 面）：
  - extractCode：`api_calls=116, final_text=y` 不再出码（回归本 bug）；`(429)`/`HTTP 500`/`status: 502`/`http=503` 仍出码；既有 `'401 Unauthorized...'`→401、`'502 Bad Gateway'`→502 断言**不变**（经原因短语锚定分支继续命中）；
  - truncation 签名：message/hint 覆写、type 仍 provider_error、code null。
- **backend**（pytest daemon session inject / auto_resume 面）：
  - 纯切换轮（空 prompt + llm_provider_id）不产 user_input 行、turn_count 不增、run 仍建且 completed；
  - 带消息切换轮（prompt 非空 + 切换字段）行为不变（user_input 照写、计数照增）；
  - queue 派发的空 prompt 切换轮同样被共享核心覆盖（如有既有用例则对齐断言）；
  - R5：chain-limit 分支后 error_detail.hint 被覆写 + auto_resume_stopped=true，type/code/raw 原值不动；未到上限路径不写标记；
  - 普通轮零回归。

## 5. 风险登记

| 风险 | 缓解 |
|---|---|
| revoke 全树扫描误删（段 id 意外同前缀） | derivesFromSegmentId 严格派生判定（`<kind>:<seg>` 前缀 + 后缀规则），同 id 只属同源流式段，实践不撞；防御用例入 §4 |
| 全桶前缀收编把「合法的同前缀独立消息」误删 | 仅删 segId 非空（流式派生）段；完整行段（segId null）不参与判定；用户消息走 user_input 通道早退不进装配 |
| **中位收编后 F7 增量投影含已删文本**（审查 P1-1） | 硬约束：dropPrefixPartialReply 实际移除段即失效该 turn 的 F7 cell（锚点置 null，下次全量重投影）；§4 对拍用例锁定 |
| inject 行为变化破坏既有切换轮测试断言 | 跑 daemon session inject 相关测试全组；断言随语义更新（以 silent_config_switch 单源注释声明语义为准，收口两处重复判定） |
| page-helpers 锚点覆盖引发 memo 身份抖动 | 沿用既有 changed 比对守卫，快照值稳定时引用不变 |
| daemon 文案改动影响依赖 message 文本的判定 | classifyModelError 类型判定先于文案覆写，type 不变；auto-recovery 消费 type/raw 不消费 message |
| R5 覆写 hint 影响失败卡既有断言/分类 | 仅覆写 error_detail.hint + 加标记键，type/code/raw 不动；新增专门用例锁定原值不变 |

## 6. 自审（⚠️ 项待验证）

- R1 修复后「丢窗口胶水段」依赖 backend 合成令箭到达——令箭 publish 与完整行同批（同 submit_messages 调用），不会缺失；Redis 丢令箭场景退化为现状（刷新治愈），不劣化。✅
- ⚠️ 自审存疑 1：`derivevesFromSegmentId` 对「segmentId 本身以 -<数字> 结尾」的理论歧义（代码注释已声明固有限度）——全树扫描放大歧义面？评估：pi/claude/codex segmentId 均含冒号，尾段是序号（ci1/3），与 `-2/-3` 唯一后缀规则不撞（注释亦称「实践不撞」）；测试加一条防御用例。
- ⚠️ 自审存疑 2：R4 中 meta.status='pending'（派发中）轮 elapsed 是否该起算——现快照锚点即 run.started_at（pending 时可能 null → 不覆盖，天然安全）。实现按「快照可解析才覆盖」收口。
- 其余项自审通过：协议零变更、分类学零变更、存量数据不动、三端可独立发布（R2 daemon 与 R1 前端无耦合；R3 backend 单端）。
