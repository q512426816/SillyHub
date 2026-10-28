---
author: flow-machine-draft
created_at: 2026-10-27T23:39:20.199Z
---
# 需求规格（Requirements）— 2026-10-28-model-retry-visible

## 功能需求

### FR-01: daemon 归一化器把 system/api_retry 帧转为 status 事件（metadata 含 attempt/max_retries/retry_delay_ms/error_status/error 摘要），session-manager 分发为新 case，经 onTurnMessage 落 [MODEL_RETRY] 单行 JSON 协议行（对齐 COMPACT_STATUS 形态；error 文本截断防超长）

- daemon 归一化器收到 `type=system, subtype=api_retry` 帧时，必须产出一条 `type=status, subtype=api_retry` 的 AgentEvent，其 metadata 必须携带 `attempt`、`max_retries`、`retry_delay_ms`、`error_status`（连接错误无 HTTP 状态时为 null）与 `error`（错误文本摘要，截断防超长）；帧缺字段时对应键可以缺省但不得伪造数值。
- session-manager 的 status 事件分发必须新增 `api_retry` case：把它经 `onTurnMessage` 落成 `[MODEL_RETRY] ` 前缀 + 单行 JSON 载荷（`attempt`/`max_retries`/`retry_delay_ms`/`error_status`/`error`，error 截断）的 stdout 文本协议行，形态对齐既有 `[COMPACT_STATUS]` 先例（ql-20260917-006）；当前轮无 runId 时必须丢弃（同 compact 口径）。
- 该透传必须为 best-effort：落行失败不得中断会话主流程。

#### 场景：429 限流重试帧透传

- Given：claude 会话运行中（currentRunId 非空），模型 API 返回可重试 429
- When：SDK 发出 `system/api_retry` 帧（attempt=3, max_retries=10, retry_delay_ms=8000, error_status=429, error 含「当前订阅套餐暂未开放GLM-5.3」）
- Then：归一化器产出 status/api_retry 事件，分发落一行 `[MODEL_RETRY] {"attempt":3,...}` stdout 文本行，backend 照既有文本行链路落库并 SSE 推送（backend 零改动）

#### 场景：连接类重试（无 HTTP 状态）

- Given：SDK 发出 api_retry 且 `error_status=null`（连接超时类）
- When：归一化与分发处理该帧
- Then：协议行载荷 `error_status` 为 null，不伪造 0 或省略键导致前端无法区分两类重试

#### 场景：无活动轮时丢弃

- Given：会话无 currentRunId（轮间隙）
- When：api_retry 帧到达
- Then：不落行、不报错（同 context_compacting 的 runId 空守卫口径）

### FR-02: 前端 session-log-assembler 新增 kind=model_retry 分类；运行中轮时间线实时显示「模型限流重试中 第N/M次」类提示（含错误摘要可读文案），终态轮不在对话正文渲染

- session-log-assembler 必须把 `[ASSISTANT] [MODEL_RETRY] ` 前缀行分类为新段 kind=model_retry（text 保留剥前缀后的 JSON 原文），判定位置必须先于通用 reply 兜底（防被当答复气泡渲染）。
- 运行中轮的时间线必须实时渲染该段为可读提示（如「模型限流重试中 第3/10次」+ 错误摘要），载荷解析失败时必须以中性文案兜底不抛错。
- 终态轮的对话正文必须不渲染重试过程段（失败原因由既有 turn.errorDetail 失败卡承担，防重复噪声）；进度/全部视图可以保留。
- turn-status-bar 的 currentActivity 回退链必须把最新 model_retry 段纳入：轮运行中且无 running 工具段时显示「模型限流重试中 第N/M次」类文案，替代恒挂「思考中」。

#### 场景：运行中轮实时可见

- Given：会话面板打开，当前轮运行中，重试风暴进行中
- When：SSE 推来 [MODEL_RETRY] 行（attempt=3）
- Then：时间线出现「模型限流重试中 第3/10次」提示（无需等轮终态），状态条 currentActivity 同步显示重试文案而非「思考中」

#### 场景：终态轮不渲染重试段

- Given：某轮已终态（成功续跑或失败）
- When：时间线渲染该轮分段
- Then：对话正文不含 model_retry 段（成功轮重试痕迹折叠不显；失败轮由 RunErrorItem 失败卡承担），既有错误卡行为不回归

#### 场景：载荷异常兜底

- Given：[MODEL_RETRY] 行 JSON 解析失败或字段缺失
- When：装配器分类与渲染
- Then：以中性「模型重试中」类文案兜底渲染，不抛错、不进对话正文

### FR-03: 纯可观测性透传：不改变 CLI/daemon 重试行为本身，不改 backend 表结构

- 本变更禁止修改 claude CLI / daemon 的重试、退避与轮终态上报行为（`is_error`→failed 映射、error_detail 落库均为既有正确行为，不得触碰）。
- 本变更禁止修改 backend 任何表结构、schema 与事件白名单——[MODEL_RETRY] 行必须走既有 stdout 文本行落库 + SSE 透传通道（backend 零改动）。

#### 场景：backend 零改动验证

- When：本变更交付 diff 与 backend/ 目录比对
- Then：backend 无文件变更；daemon 侧既有单测（含 turn 终态、事件白名单）全绿

### FR-04: daemon 与前端新增单测覆盖：归一化 api_retry 帧、分发落行、前端分类与渲染；相关既有测试不回归

- daemon 侧必须新增单测覆盖：api_retry 帧归一化（含 error_status=null 连接类与缺字段容错）、分发落 [MODEL_RETRY] 行（含 runId 空丢弃、error 截断）。
- 前端侧必须新增单测覆盖：装配器分类（含解析失败兜底）、运行中轮渲染、终态轮不渲染、状态条 currentActivity 重试文案。
- 交付时 daemon 与前端相关测试套件必须全绿，既有用例零回归。

#### 场景：交付自证

- When：跑 daemon vitest 相关文件与前端 vitest 相关文件
- Then：新增用例全过、既有套件零回归（收口按测试对账面亲测复核）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/interactive/claude-events.test.ts「api_retry 帧归一化为 status 事件」
FR-01: sillyhub-daemon/tests/interactive/session-manager-status-dispatch.test.ts「api_retry 落 [MODEL_RETRY] 协议行」
FR-02: frontend/src/components/daemon/__tests__/session-log-assembler.test.ts「MODEL_RETRY 行分类为 model_retry 段」
FR-02: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「运行中轮渲染重试提示、终态轮不渲染」
FR-02: frontend/src/components/daemon/__tests__/turn-status-bar-phase.test.tsx「重试段纳入 currentActivity 回退链」
FR-03: 不适用：纯约束性 FR（禁改面），验证手段=FR-04 既有套件零回归 + 交付 diff 无 backend 文件，无可执行断言
FR-04: sillyhub-daemon/tests/interactive/claude-events.test.ts「api_retry 缺字段与 error_status=null 容错」
FR-04: frontend/src/components/daemon/__tests__/session-log-assembler.test.ts「MODEL_RETRY 载荷解析失败中性兜底」
