---
author: qinyi
created_at: 2026-09-13 00:53:34
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 会话用户 | 在会话面板查看各引擎会话的上下文窗口占用环，据此判断何时压缩/换会话 |
| 引擎接入开发者 | 未来为平台接入新 interactive 引擎，依赖 caps 契约与守护测试保证功能不遗漏 |

## 功能需求

### FR-01: pi 会话上下文用量
覆盖决策：D-001@v1
Given pi 会话完成一轮含工具调用的对话（turn_end 携带 usage）
When 归一化器构造 usage 快照事件
Then `usage.ctx_tokens = input + cacheRead + cacheWrite`（净值三和，pi-ai 全 provider 净值口径），经既有链路透传后环显示真实百分比

Given pi 错误轮 turn_end usage 全零
Then 事件携带 `ctx_tokens: 0`（全零是该轮真实用量事实，与「缺键未知态」并列成立，设计已明示口径）

### FR-02: cursor 会话上下文用量
覆盖决策：D-001@v1
Given cursor 会话产出 result 帧（usage camelCase 四维，inputTokens 为净值——fixture 跨轮连续性验证）
When `mapUsage` 映射字段
Then `ctx_tokens = inputTokens + cacheReadTokens + cacheWriteTokens`；头注释「cursor 侧无 ctx 维度」同步修正

Given usage 任一有效字段存在
Then 派生 ctx（缺失分量按 0 计）；全缺 → 不携带（缺键即未知态，不伪造）

### FR-03: codex 会话上下文用量
覆盖决策：D-001@v1
Given codex 每次 API 调用后发 `thread/tokenUsage/updated` 通知（total 线程累计 / last 单调用，inputTokens 毛值含 cache）
When `_extractTokenUsage` 解析
Then 存 `lastCallCtxTokens = last.inputTokens`（毛值直取）；`_usageDelta`（usage_update 载体）与 `_applyTurnUsageDelta`（turn result）两路 usage 均附加 `ctx_tokens`

Given 通知缺 `last` 或字段非法
Then 不携带 ctx_tokens（环保持未知态，四维 token 照旧上报，纯降级）

### FR-04: ProviderCaps 第 11 键 ctx_usage 三端贯通
覆盖决策：D-001@v1
Given providers.ts 单源 ProviderCaps 加 `ctx_usage: boolean`、四引擎 true、未知回退 false
When gen-provider-caps.mjs 生成（CAPS_KEYS + renderFrontend 模板接口体 + 回退字面量 + 三处「10 键」文案同步）
Then frontend/provider-caps.ts 与 backend/provider_caps.py 两份 @generated 产物含新键；双守护测试（alignment EXPECTED_CAPS_KEYS + 两处 len==10 断言同步 11、provider-registry 契约键清单）绿

Given 新引擎接入 INTERACTIVE_PROVIDERS 漏声明 ctx_usage
Then satisfies TS2741 编译红 + 守护测试红（防遗漏强制）

### FR-05: 派生公式单源
覆盖决策：D-001@v1
Given 新增 `usage-ctx.ts` 共享 helper（`ctxTokensFromNetInput` 净值三和 / `ctxTokensFromGrossInput` 毛值直取；全缺 → undefined）
When claude/pi/cursor 派生与 codex 取值
Then 均引用 helper（claude :946 求和处改调，行为零变化；差分路径维持原样注释锚定）；口径一处定义

### FR-06: 前端 caps 门控
覆盖决策：D-001@v1
Given CtxUsageBar 加 `provider?: string | null` prop（全仓调用点仅 session-panel-page.tsx:2709/:3501 两处）
When `provider != null && !getProviderCaps(provider).ctx_usage`
Then 只渲染 QuotaPill 不渲染环；provider 为 null/未知 → 照常渲染环（本机默认供应商不回归）

### FR-07: 真机验证
覆盖决策：D-001@v1（R-01/R-02 风险闭环）
Given 本机 codex-cli 0.147.0 与 pi 0.81.1
When 真机各跑一轮含工具调用会话
Then codex 抓 `thread/tokenUsage/updated` 确认 `last` 形态与取值（结论记 QUICKLOG）；pi 复核 turn_end 单调用快照语义；三引擎环真机显示百分比

## 非功能需求

- 兼容性：旧 daemon/历史 run（ctx_tokens NULL）行为不变——事件缺键即跳过、环未知态；REST DTO 与 SSE envelope 零变化；`_liftSessionUsage`/budget 台账零影响（只读 input/output 两键）
- 可回退：codex `last` 缺失纯降级不携带；前端门控 provider=null 旁路；caps 生成脚本响亮失败守卫（解析不完整零写盘）
- 可测试：helper 纯函数单测；三解析器 fixture 断言（值 + 缺字段不伪造）；守护测试三端对账；前端门控三分支

## 决策覆盖矩阵（如存在 decisions.md）

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01~FR-07 | 方案 A 全量：归一化器源头派生 + caps 声明 + 共享 helper + 前端门控 + 真机验证；B/C 否决理由（轮累计不可消费侧反推）构成本设计派生位置的约束 |
