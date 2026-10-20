---
author: flow-machine-draft
created_at: 2026-10-20T03:44:06.234Z
---
# 需求规格（Requirements）— 2026-10-20-session-error-visibility

## 功能需求

### FR-01: 失败轮（error_code=interactive_interrupted 且 error_detail 非空）在会话页面渲染错误卡，轮状态显示为失败而非已中止

- run 快照 status=failed 且 error_code=interactive_interrupted 且 error_detail 可解析出模型错误项时，前端必须把该轮显示为「失败」并回填 errorDetail（渲染 RunErrorItem 错误卡），禁止按「已中止」处理吞掉错误信息。判定依据：backend close_run_steps 对 SDK error_during_execution 统一落 interactive_interrupted，其中模型错误伴随 error_detail 非空（daemon classifyModelError 产物），真打断 error_detail 为空——error_detail 可解析即模型失败。

#### 场景：快照回看（刷新页面）

- Given 会话含 run（status=failed / error_code=interactive_interrupted / error_detail.raw="codex exited code=1"）
- When 用户打开/刷新会话页面（logs+runs 快照装配）
- Then 该轮渲染 RunErrorItem 错误卡（含 raw 首行摘要），轮状态徽标为失败而非已中止

#### 场景：实时 SSE 终态回补

- Given 用户在会话页面，某轮实时收到 turn_completed（status=failed / error_code=interactive_interrupted）
- When 后端 runs 快照刷新拉回该 run 且 error_detail 可解析
- Then 该轮被修正为失败并渲染错误卡；若 error_detail 为空（真打断）则保持已中止

### FR-02: 错误卡默认直接可见原始错误文本首行（如 codex exited code=1），无需点击查看详情

- RunErrorItem 在 raw 非空时必须在错误卡正文默认展示 raw 首行摘要（单行截断，约 200 字符内），「查看详情」按钮保留用于展开完整 raw；禁止把 raw 完全藏在折叠区内默认不可见。

#### 场景：unknown 兜底错误

- Given errorDetail type=unknown / message="运行失败" / raw="codex exited code=1"
- When 错误卡渲染
- Then 卡上默认可见文本 "codex exited code=1"（无需任何点击）

### FR-03: 真打断（error_detail 为空的 interactive_interrupted）仍显示已中止，不出现错误卡

- error_detail 为空（或不含模型错误键）的 interactive_interrupted 轮必须维持现状语义：轮状态显示「已中止」，不渲染错误卡、不误报为失败。

#### 场景：用户手动打断

- Given run status=failed / error_code=interactive_interrupted / error_detail=null
- When 会话页面渲染
- Then 轮状态显示已中止，无错误卡（与现状一致，零回归）

### FR-04: 相关前端测试更新并通过

- 本变更触及的前端模块必须有测试覆盖并通过：enrichDisplayTurns 的 killed→failed 升级判定（含真打断零回归）与 RunErrorItem raw 摘要默认展示。

#### 场景：测试运行

- Given 变更代码落盘
- When 运行 frontend 相关 vitest 套件
- Then 全部通过（新增用例与既有用例无回归）

## 测试绑定

FR-01: frontend/src/components/daemon/__tests__/page-helpers-error-visibility.test.ts「interrupted 带 error_detail 快照升级为失败并回填 errorDetail」
FR-01: frontend/src/components/daemon/__tests__/page-helpers-error-visibility.test.ts「实时终态条件扩展由快照升级同源判定覆盖（enrichDisplayTurns 与终态回补共用 buildErrorLogItem，快照用例即契约锚）」
FR-02: frontend/src/components/agent-log/__tests__/run-error-item.test.tsx「raw 首行摘要默认可见无需点击」
FR-03: frontend/src/components/daemon/__tests__/page-helpers-error-visibility.test.ts「真打断 error_detail 为空保持已中止零回归」
FR-04: frontend/src/components/agent-log/__tests__/run-error-item.test.tsx「长 raw 首行截断展示」
