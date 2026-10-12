---
author: qinyi
created_at: 2026-10-12 20:48:11
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-10-12-session-defects

## 背景

生产会话 47e2ff1a（消防设施器材1轮，30 轮 / 5654 条日志 / 174 任务行，导出档 `会话导出_完整信息_20261012_121913.zip`）暴露平台五组缺陷，全部有生产实证：

| 组 | 缺陷 | 生产实证 |
|---|---|---|
| F1 | 错误归因粗粒度 + 上下文超限无自动恢复 | runs 3-12 连续 10 轮 `interactive_failed`（实为 "Prompt is too long"，分类器落 unknown），用户被堵 43 分钟靠手动 /compact 解围；run 30 构建已成功但收口时撞 429 配额，会话整体判 failed |
| F2 | 日志时间戳塌缩 + 消息碎片化 | 同一毫秒时间戳聚集 8~31 行 ×8 簇；同一助手消息被拆成十几个重复/截断片段行，导出与回放显示乱码 |
| F3 | 任务幽灵行 | agent_session_task 23 组「stopped(空摘要)+completed(真摘要)」成对行，174 行实际约 151 个任务 |
| F4 | 策略写守卫路径解析误拒 | deny 文案「目标路径：`<工作区>/-p`」（flag token 被当路径）；工作区 `/mnt/e/...` 被解析成 daemon 启动目录 `/mnt/c/Users/...`（相对路径锚点错误），开场全部写入被误拒 |
| F5 | 导出与元数据残缺 | session.config_snapshot 的 model/provider 全 NULL；被打断的工具调用无 tool_call 日志行（run 27） |

## 设计目标

1. F1：`context_overflow` 全链路归因（daemon 分类 → backend error_detail → 前端专属错误卡）；上下文超限后平台**编排 agent 原生压缩**（不重造压缩）自动续跑，带防循环熔断；429 配额卡透出重置时间。
2. F2：日志行时间戳反映事件发生时刻（同批不再共享单值）；同一助手消息最终只落一行完整内容。
3. F3：一个逻辑任务在 agent_session_task 至多一行真实终态；生产幽灵行模式有复现测试且修复后转绿；导出/列表不出现同任务双行。
4. F4：shell 写路径提取不再把 `-x` flag token 当目标；相对路径按会话工作区根解析；deny 文案附双拼写可操作提示。
5. F5：config_snapshot 落 model/provider；打断的工具调用补落日志行；导出任务去重。

## 非目标

- 不实现任何平台侧上下文压缩/摘要逻辑（D-R01 否决，压缩一律走 agent 原生 `compact_session` 双分路）。
- 不修 sillyspec CLI 自身缺陷（cwd 耦合、deps 门控）——记档 `docs/sillyspec/`（D-008）。
- 不改 AgentRunLog / agent_session_task / agent_sessions 表结构（零 migration，全部复用既有列）。
- 不改 error_code 与 error_detail 的正交契约（backend/app/modules/daemon/run_sync/service/close_run_steps.py:288 既有 D-009 决策保持）。
- 不重构 stream-json adapter 事件模型（碎片合并在 wire 转换层做，不动 adapter 协议）。

## 拆分判断

五组缺陷同源（同一生产会话导出），共享同一批决策上下文与证据基线，合一个变更避免五次流程开销。内部按 D-002@v1 两波分层：波1（F2/F3/F5）数据管道可靠性先行——机械性低风险、且修好后波2（F1/F4）的调试与验收能依赖干净的时间戳/任务数据；波边界即验收检查点。不走批量模式：本变更无外部仓（backend/sillyhub-daemon/frontend 均在主仓内），无需按仓拆分。

## 总体方案

### Wave 1（数据管道可靠性，先行）

**W1-T1 F2a 日志事件时间戳（daemon wire + backend 落库）**
- 根因：backend/app/modules/daemon/run_sync/service/submit_steps.py:566 `AgentRunLog(..., timestamp=st.now, ...)`——`st.now` 是单次 submit 调用共享的单值，整批行同刻度。
- wire 消息对象（sillyhub-daemon/src/event-wire.ts 各 case 构造处 + sillyhub-daemon/src/types.ts:707 消息类型）增加可选 `timestamp` 字段（ISO 字符串，事件到达时 `new Date().toISOString()` 捕获，而非批处理转换时刻）。
- backend submit_steps 落库改为：`timestamp = 解析 msg["timestamp"]`，解析失败/缺省/与本地钟差 >5 分钟回落 `st.now`（防 daemon 时钟漂移污染时间线）；SSE 日志推送（submit_steps.py:605 区 published_logs）同步携带同一事件时间戳，保证流式与落库时间线一致（Grill 复审注记吸收）。

**W1-T2 F2b 消息碎片合并（daemon wire 层）**
- 新增纯函数缓冲器 NEW:sillyhub-daemon/src/agent-log/message-coalescer.ts：按 message id 缓冲连续 assistant/thinking 流式 delta，message 完结事件到达时输出单行完整内容；wire 转换（event-wire.ts）接入。
- 核查 segment_id partial→final 覆盖链路（submit_steps segment DELETE 机制）在 claude 流式路径的覆盖面，补删残留 partial 行。

**W1-T3 F3 任务幽灵行（backend，含根因调查）**
- 调查任务：以生产成对模式（同 session 同名 stopped(None)+completed(摘要)）为复现目标写失败测试，追 task_id 生命周期（daemon 生成/重放）与 sweep_confirmed_dead_tasks 竞态，定位成对行成因。
- 修复（按调查结论，方向已定）：终态保护——已真实终态行不被 sweep 改写；同名新 task_id 事件到达时若旧行已真实终态则合并到新行并停用旧行（或重映射 task_id），保证「一逻辑任务一行」不变量。
- 兜底：backend/app/modules/daemon/session/service/export.py 导出任务渲染去重 + backend/app/modules/daemon/router/session_insights.py 任务列表 API（GET /sessions/{id}/tasks，:602）同口径去重（同 session 同名取最新真实终态行）——D-005 normalized_requirement 覆盖「导出与任务列表」两面（Grill X3 gap 修正）。
- 「停用旧行」若引入标记机制，必须与 `RUN_CLOSE_SWEEP_REASON`（agent_task_store.py RUN_CLOSE_SWEEP_REASON 常量）显式区隔：复活守卫仅精确匹配该清扫文案，新停用标记不得复用该字符串，防清扫 stopped 行被误当可合并对象（Grill X3 gap 修正）。

**W1-T4 F5 导出与元数据（backend + daemon）**
- config_snapshot 补 model/provider：dispatch 时点（backend/app/modules/daemon/session/service.py:3359 附近已有 llm_provider_id 写入先例）快照写入 session.config_snapshot。
- 打断工具调用补日志：daemon 侧 run 中断/拒绝路径核查 tool_call 行发射时序，保证「有拒绝结果必有对应 tool_call 行」（复用 event-wire 补发）。
- 导出去重与 W1-T3 共用。

### Wave 2（行为类，后行）

**W2-T1 F1a 归因：context_overflow 分类（daemon + backend schema + frontend 类型链）**
- sillyhub-daemon/src/model-error/types.ts：ModelErrorType 增加 `context_overflow`。
- sillyhub-daemon/src/model-error/classifier.ts：归类规则插在 429 规则之后、auth 之前；关键词 `Prompt is too long`（大小写不敏感）/ `maximum context length` / `context_length_exceeded` / `context window`；ERROR_INFO 文案：message「会话上下文超出模型窗口」、hint「平台将自动压缩会话并续跑；若自动恢复失败请手动 /compact 或新建会话」、retryable=false。
- backend/app/modules/daemon/schema.py ModelErrorType Literal 同步增加 `context_overflow` → `pnpm gen:types` 重新生成 frontend/src/lib/api-types.ts（CLAUDE.md 规则 21 禁手写）。
- frontend/src/components/agent-log/normalize.ts + run-error-item.tsx：MODEL_ERROR_META 增加 context_overflow 专属中文卡（进行态「上下文已满，正在自动压缩续跑」/终态「请手动压缩或新建会话」）；quota 卡透出 error_detail.resetAt 倒计时。

**W2-T2 F1b 自动恢复编排（backend auto_resume）**
- backend/app/modules/daemon/session/service/auto_resume.py 的 maybe_auto_recover_failed_turn 新增 context_overflow 分支（依赖 W2-T3 调查结论先行——G0 总门要求 session active，见 tasks 依赖）：
  1. error_detail.type == context_overflow 且 provider caps compact=true；
  2. 熔断检查：仿 `_count_chain_type`（auto_resume.py:660）数连续 context_overflow 链，`CONTEXT_OVERFLOW_CHAIN_LIMIT = 2`，超限不再自动恢复（写链上限提示，走 `_write_chain_limit_hint` 同款）；
  3. 调 `compact_session`（backend/app/modules/daemon/session/service/compact.py:78，claude 注入原生 `/compact`，pi/codex 走 session_compact RPC）；
  4. compact 成功 → **对齐 quota 分支形态函数内直插** `AgentSessionScheduledMessage`（auto_resume.py:452-467 先例、分支 B 形态 :626-642）重放本轮用户消息，delay=0；重放提示词**新增场景化模板**（context_overflow 专用：说明「上下文已满已自动压缩、以下为你的原始消息」），不复用 `wrap_resume_prompt` 的 daemon 重启语境文案，`wrap_resume_prompt` 仅作标记位复用（Grill 复审注记吸收）。**禁止走 `maybe_enqueue_auto_resume`**——其 G3 门禁（auto_resume.py:193）仅放行 error_code=daemon_restarted，context_overflow 必被拒（Grill X2 阻断修正）；
  5. compact 失败/不支持 → 不重试；**except 边界内必须走 `_write_chain_limit_hint` 同款引导写入**（auto_resume.py:696-720 先例，AppError 类业务失败不得静默吞引导），仅 DB 写入失败才降级纯日志（Grill X2 gap 修正）。
- 静默容错边界收窄：恢复动作的异常不影响已 commit 终态（NFR 不变），但用户引导面不许被吞。

**W2-T3 F1c 会话状态语义调查与修正（backend）**
- 调查：会话 47e2ff1a 终态 failed 与 backend/app/modules/daemon/session/service/helpers.py:99（多轮返 active）矛盾——找出真实翻 failed 路径（候选：gate 拒绝覆写 close_run_steps.py:496、mark_session_recovery_failed、手动关闭、run 30 的 spec_strategy 非 interactive）。
- 修正（按调查结论）：可自动恢复失败（context_overflow/quota 且恢复预算未耗尽）不得把 interactive 会话终态化；恢复预算耗尽才允许 failed。

**W2-T4 F4 策略写守卫路径解析（daemon）**
- sillyhub-daemon/src/policy/shell-paths.ts：tee/mkdir/touch 捕获组（:125-135）与重定向目标补 `-` 前缀 token 过滤（捕获即弃，不产出目标）；按 D-007「全部捕获目标」口径，PowerShell/CMD 提取器的位置参数捕获同轮过滤（Grill 复审注记吸收）。
- anchor 传递链（Grill X4 阻断修正——必须贯通到解析层）：sillyhub-daemon/src/policy/path-utils.ts 的 normalizePath/resolveRealPath/isPathUnderAnyRoot 增加 anchor 参数（相对路径解析基点，对 target 与 roots 双解析均生效，默认 process.cwd() 行为不变）；sillyhub-daemon/src/policy/filesystem-policy.ts 的 canWrite/canCreate/canDelete/canRename（judgeWrite :182、isPathUnderAnyRoot :201 调用点）签名透传 anchor；sillyhub-daemon/src/interactive/session-manager/write-guard.ts 四条分支（policyEngine 主路径 :250、fallback :129、borrow :215、overlay :238）全部传会话工作区根（SessionState 已有 rootPath）。
- deny 文案：filesystem-policy.ts buildDenyReason 在 normalizedPath 与原始路径拼写不一致时附「原始路径 X 解析为 Y」提示。

**W2-T5 记档（docs/sillyspec/，D-008）**
- NEW:docs/sillyspec/cli-cwd-coupling.md（CLI worktree 内跑把 cwd 当独立 spec root）
- NEW:docs/sillyspec/deps-gate-offline-fragile.md（npm ci 离线失败→手工改 meta.json 绕过链路）

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/event-wire.ts | 消息构造补 timestamp 字段（事件到达时刻捕获）；接入 delta 合并缓冲器 |
| 修改 | sillyhub-daemon/src/types.ts | wire 消息类型增加可选 timestamp 字段（producer=daemon 事件转换 → submit payload 透传 → consumer=backend submit_steps 落库 AgentRunLog.timestamp） |
| 新增 | NEW:sillyhub-daemon/src/agent-log/message-coalescer.ts | 按 message id 缓冲流式 delta、消息完结单行输出的纯函数缓冲器 |
| 新增 | NEW:sillyhub-daemon/tests/agent-log/message-coalescer.test.ts | 合并缓冲器单测（delta 序列→单行；跨消息隔离；完结/中断两态） |
| 修改 | backend/app/modules/daemon/run_sync/service/submit_steps.py | timestamp 改为优先 msg["timestamp"]（钟差>5min/非法回落 st.now，替换现 st.now 整批单值） |
| 修改 | backend/app/modules/daemon/agent_task_store.py | 幽灵行修复：终态保护 + 同名新 id 合并/重映射（按 W1-T3 调查结论落地） |
| 修改 | backend/app/modules/daemon/session/service/export.py | 导出任务快照去重（同 session 同名取最新真实终态行） |
| 修改 | backend/app/modules/daemon/session/service/create.py | config_snapshot 补齐 model/provider_name/profile_name（创建时已落 model 先例，修绑定前创建为 null 的窗口） |
| 修改 | backend/app/modules/daemon/session/service/inject.py | 供应商切换/绑定后回写 config_snapshot 快照（保证导出非空） |
| 修改 | sillyhub-daemon/src/model-error/types.ts | ModelErrorType 增加 context_overflow |
| 修改 | sillyhub-daemon/src/model-error/classifier.ts | 归类规则 + ERROR_INFO 中文文案 |
| 修改 | sillyhub-daemon/tests/model-error/classifier.test.ts | context_overflow 归类用例（如文件不存在则 NEW:） |
| 修改 | backend/app/modules/daemon/schema.py | ModelErrorType Literal 增加 context_overflow → 触发 pnpm gen:types |
| 修改 | frontend/src/lib/api-types.ts | pnpm gen:types 重新生成（禁止手写，CLAUDE.md 规则 21） |
| 修改 | frontend/src/components/agent-log/normalize.ts | context_overflow 类型透传 |
| 修改 | frontend/src/components/agent-log/run-error-item.tsx | MODEL_ERROR_META 增加 context_overflow 中文卡；quota 卡 resetAt 倒计时 |
| 修改 | backend/app/modules/daemon/session/service/auto_resume.py | context_overflow 自动恢复分支（调 compact_session + 重放 + 熔断=2） |
| 修改 | backend/app/modules/daemon/session/service/helpers.py | 会话终态语义修正（按 W2-T3 调查结论） |
| 修改 | sillyhub-daemon/src/policy/shell-paths.ts | tee/mkdir/touch/重定向捕获组过滤 `-` 前缀 token |
| 修改 | sillyhub-daemon/src/policy/path-utils.ts | normalizePath/resolveRealPath/isPathUnderAnyRoot 增加 anchor 参数（target 与 roots 双解析生效，默认 process.cwd() 行为不变） |
| 修改 | sillyhub-daemon/src/interactive/session-manager/write-guard.ts | 四条分支（主路径/fallback/borrow/overlay）裁决传会话工作区根锚点 |
| 修改 | sillyhub-daemon/src/interactive/session-manager/turn-control.ts | 打断/拒绝路径 tool_call 行发射时序补口（task-05 调查落点，填卡阶段实测定位） |
| 修改 | sillyhub-daemon/src/policy/filesystem-policy.ts | canWrite/canCreate/canDelete/canRename 签名透传 anchor；deny 文案双拼写提示 |
| 修改 | backend/app/modules/daemon/router/session_insights.py | 任务列表 API（:602）渲染同 session 同名去重（与导出同口径，D-005「导出与任务列表」双面） |
| 新增 | NEW:docs/sillyspec/cli-cwd-coupling.md | sillyspec CLI 缺陷记档（D-008） |
| 新增 | NEW:docs/sillyspec/deps-gate-offline-fragile.md | sillyspec CLI 缺陷记档（D-008） |
| 修改 | sillyhub-daemon/tests/task-runner.test.ts | 门面 golden 断言剥离动态 timestamp（F2a 透传连带 ×7，执行期裁决 D-012@v1：plan 漏列 related_tests 补口，QA 审查后显式收录） |

测试文件随任务就地新增/修改（backend pytest 按 module 策略、daemon vitest、frontend vitest），不逐一点名。

## 接口定义

### wire 消息（daemon → backend submit payload）

```ts
// sillyhub-daemon/src/types.ts 消息类型增加：
interface WireMessage {
  event_type: string;
  content?: string;
  channel?: string;
  tool_kind?: string | null;
  segment_id?: string;        // 既有
  timestamp?: string;         // 新增：ISO-8601 事件到达时刻；缺省=旧行为
}
```

producer=sillyhub-daemon/src/event-wire.ts（各消息构造点 new Date().toISOString()）→ submit_lease_messages payload 透传 → consumer=backend submit_steps.py（解析失败/钟差>5min 回落 st.now）。

### 分类器（daemon）

```ts
// sillyhub-daemon/src/model-error/types.ts
type ModelErrorType =
  | 'quota_exceeded' | 'rate_limited' | 'context_overflow'  // 新增
  | 'auth_failed' | 'timeout' | 'model_not_found'
  | 'network' | 'provider_error' | 'unknown';
```

### 自动恢复分支（backend）

```python
# backend/app/modules/daemon/session/service/auto_resume.py
CONTEXT_OVERFLOW_CHAIN_LIMIT = 2  # 连续 context_overflow 自动恢复上限

# maybe_auto_recover_failed_turn 新增分支（quota_exceeded 分支之后）：
#   error_detail.type == "context_overflow"
#   → 链计数 < CONTEXT_OVERFLOW_CHAIN_LIMIT
#   → compact_session(svc, session_id, user_id)   # 复用既有双分路
#   → accepted → 函数内直插 AgentSessionScheduledMessage（对齐 quota 分支
#     auto_resume.py:452-467 / 分支 B :626-642 形态；禁走 maybe_enqueue_auto_resume
#     ——其 G3 门禁仅放行 daemon_restarted）重放原文，delay=0
#   → 失败/AppError → _write_chain_limit_hint 同款引导写入（不静默吞引导）
```

### 既有 REST/WS 端点零变化

本变更接口面：0 端点（无新增/修改端点；wire 字段向后兼容可选）。

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| turn 终态（context_overflow） | daemon | backend close_interactive_run | runId, status, error(ModelErrorDTO type=context_overflow) | run → failed；session 状态按 W2-T3 修正语义（active 保持，不终态化） |
| 自动压缩触发 | backend auto_resume | backend compact_session（进程内） | sessionId, userId | 无状态迁移（compact 走既有 inject/RPC 双分路） |
| 压缩续跑消息入队 | backend auto_resume | backend 定时消息表 | sessionId, prompt(wrap_resume_prompt 标记), delay=0 | 排队 → 下一轮 run（running） |
| 熔断（连续 ≥2 次 context_overflow） | backend auto_resume | （无外部接收方） | runId | 不入队；run 保持 failed；session 按 W2-T3 语义 |
| 任务清扫（run close） | backend sweep_confirmed_dead_tasks | backend agent_session_task | runId, hub(daemon 注册表查询) | running 行 → stopped（带 RUN_CLOSE_SWEEP_REASON 标记）；真实终态行不受影响（W1-T3 修复后） |
| 写路径拒绝 | daemon PolicyEngine | claude CLI（deny message） | provider, normalizedPath, cause | 无状态迁移（工具调用被拒） |

## 数据模型

无 schema 变更（零 migration）。复用既有列：agent_run_logs.timestamp（值语义改为事件时刻）、agent_runs.error_detail（context_overflow 新枚举值）、agent_sessions.config_snapshot（补 model/provider 键）、agent_session_task（无新列，行为修复）。

## 兼容策略（brownfield）

1. wire `timestamp` 字段可选：旧版 daemon 不带 → backend 回落 st.now，行为与现状完全一致；新版 daemon + 旧版 backend → 未知字段被忽略（payload 宽松解析），零破坏。
2. ModelErrorType 新枚举值：分类器在 daemon 侧，随 daemon 发版。部署顺序约定 backend 先发、daemon 后发。倒置风险写实（Grill X2 gap 修正）：pydantic Literal 对未知枚举默认校验拒绝（422），error 挂在 close_interactive_run 请求体内，拒绝可能导致 run 无法收口（卡 running）——比「退化为 unknown」严重。execute 首任务实测 Literal 对未知值行为：若确认拒绝，backend 发版须同轮附带宽松校验（改 str 校验 + validator 把未知值归 unknown）后再允许 daemon 发新枚举。
3. auto_resume context_overflow 分支：caps.compact=false 的引擎自动跳过（走既有 unknown 路径），未配置新逻辑时行为不变。
4. path-utils anchor 参数默认值 = 现行为（process.cwd()）；仅 write-guard 显式传会话根，其他调用点零变化。
5. 不改变的 API：全部 REST/WS 端点签名、表结构、error_code/error_detail 正交契约（close_run_steps.py:288 D-009）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | compact 完成误判（压缩中超时被当作成功）导致重放消息再次爆窗 | P1 | 重放后 run 若再次 context_overflow，熔断链计数+1，第 2 次后停止自动恢复；重放消息带 wrap_resume_prompt 标记可观测 |
| R-02 | delta 合并缓冲器泄漏（消息无完结事件）导致内容丢失 | P0 | 缓冲器带 TTL/缓冲上限（超限冲刷为独立行，宁可碎片不丢内容）；单测覆盖中断态 |
| R-03 | wire 钟差（daemon 时钟漂移）污染时间线 | P2 | backend 侧 ±5 分钟钟差守卫回落本地时钟 |
| R-04 | F3 根因在 daemon 侧 task_id 重生成，修复跨端拉长波1 | P1 | 调查任务限时；导出/列表去重兜底可独立交付 |
| R-05 | 部署顺序倒置（daemon 先于 backend）Literal 校验拒绝未知枚举致 close 422、run 卡 running | P1 | 兼容策略 §2：backend 先发；execute 首任务实测 Literal 行为，拒绝则 backend 同轮附带宽松校验（validator 归 unknown）发版 |
| R-06 | 相对路径锚点改动使既有依赖 daemon cwd 的合法写被拒 | P1 | anchor 仅 write-guard 裁决路径生效；回归跑 policy 全量既有测试 |
| R-07 | 会话状态语义修正（W2-T3）与 gate 拒绝覆写（close_run_steps.py:496）叠加产生新死锁 | P1 | 决策追踪组合推演：gate 覆写优先级保持高于 active 保持，无死锁格 |
| R-08 | 生命周期面：无长驻进程/外部资源引入（auto_resume 为既有请求内钩子，message-coalescer 为请求内纯函数缓冲） | P2 | 无长驻进程/外部资源，生命周期面不适用（显式留痕） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 五组 FR 全覆盖（总体方案 §Wave1/2）；非目标排除范围外项 | 已覆盖 |
| D-002@v1 | 总体方案两波结构；风险 R-04 波1 超期对策 | 已覆盖 |
| D-003@v1 | W2-T2 编排复用 compact_session；非目标第 1 条；生命周期契约表压缩触发行 | 已覆盖 |
| D-004@v1 | W1-T1/W1-T2；接口定义 wire timestamp；兼容策略 §1 | 已覆盖 |
| D-005@v1 | W1-T3 不变量与兜底；风险 R-04 | 已覆盖 |
| D-006@v1 | W2-T3 调查与修正；生命周期契约表终态行；风险 R-07 | 已覆盖 |
| D-007@v1 | W2-T4 三项修法；风险 R-06 | 已覆盖 |
| D-008@v1 | W2-T5 记档两个 NEW 文件；非目标第 2 条 | 已覆盖 |

无未解决决策。组合推演：D-003（恢复编排）×D-006（会话状态）相互约束——推演矩阵：恢复成功→重放轮 running→session active ✓；恢复失败/熔断→session 按修正语义保持 active 交回用户 ✓；gate 拒绝覆写×本修正→_is_gate_rejected_first_failure 命中仍覆写 failed（gate 优先级不变）✓，无死锁格。落选方案 D-R01（平台自实现压缩）/D-R02（仅修 F1）见 decisions.md。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 文件清单 NEW: 前缀合规（message-coalescer.ts 及测试、docs/sillyspec ×2）；既有路径仓根相对正斜杠
- [x] 对外字段（wire timestamp）已标 producer→consumer 数据流
- [x] 生命周期契约表必填（涉及 session/run/daemon/状态迁移）且事件×任务映射齐
- [x] 无 schema 变更显式留痕
- [x] 决策追踪 D-001~D-008 全覆盖 + 落选方案留档 + 组合推演
- [x] ⚠️ 自审存疑两点（不阻断，execute 首任务实证）：① F3 根因候选（daemon task_id 重生成 vs sweep 竞态）需实证，修法允许按证据微调（「一逻辑任务一行」不变量不动）；② W2-T3 翻 failed 真实路径待调查，修正方向（恢复预算内不终态化）已定，落点函数允许同级文件内调整（语义不变）
