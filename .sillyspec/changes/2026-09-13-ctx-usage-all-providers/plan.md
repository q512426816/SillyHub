---
plan_level: full
---

# 实现计划（Plan）：上下文窗口用量全引擎接入 + ctx_usage 能力键

## Spike 前置验证（如需要）

| Spike | 验证内容 | 不通过后果 |
|---|---|---|
| spike-01 | 真机 codex 会话抓 `thread/tokenUsage/updated` 原始通知，确认 `last` 字段存在且 `last.inputTokens` 为单调用毛值（唯一未实证假设，R-01） | task-04 降级：不解析 `last`、不携带 ctx_tokens，codex caps 如实 false（R-01 降级路径，非推翻重设计） |

> spike-01 并入 task-08 首步执行（真机验证任务内），不单列 Wave——设计已带降级路径，不阻塞 W1/W2 实现。

## Wave 1（并行，无依赖）
- task-01
- task-06

## Wave 2（依赖 Wave 1）
- task-02
- task-03
- task-04
- task-05
- task-07

## Wave 3（依赖 Wave 2）
- task-08

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 新增 usage-ctx.ts 共享派生 helper + 单测 | W1 | P0 | — | FR-05, D-001@v1 | `ctxTokensFromNetInput`（净值三和）+ `ctxTokensFromGrossInput`（毛值直取）；全缺 → undefined 不伪造；缺失分量按 0 计 |
| task-02 | pi-events buildUsageEvent 派生 ctx_tokens + fixture 断言 | W2 | P0 | task-01 | FR-01, D-001@v1 | 净值三和；numOr0 恒数值→pi 恒派生（错误轮全零 ctx=0 是有意口径，设计已明示） |
| task-03 | cursor-events mapUsage 派生 ctx_tokens + 修正旧注释 + fixture 断言 | W2 | P0 | task-01 | FR-02, D-001@v1 | 净值三和；:37-40「无 ctx 维度」旧注释同步修正 |
| task-04 | codex driver 解析 last + 两路 usage 附加 ctx_tokens + 测试 | W2 | P0 | task-01 | FR-03, D-001@v1 | `lastCallCtxTokens = last.inputTokens` 毛值直取；`_usageDelta`（usage_update）与 `_applyTurnUsageDelta`（turn result）双路携带；last 缺失不携带 |
| task-05 | claude-events 改调共享 helper（行为零变化） | W2 | P1 | task-01 | FR-05, D-001@v1 | :946 三分量求和改调 helper；差分路径（:1007-1008）原样保留注释锚定；既有 claude-events 测试全绿兜底 |
| task-06 | ProviderCaps 第 11 键 ctx_usage + gen 脚本同步 + 三端生成 + 双守护测试同步 | W1 | P0 | — | FR-04, D-001@v1 | providers.ts 接口/表/回退三处 + CAPS_KEYS + renderFrontend 模板（接口体 :218-246 + 回退字面量 + 「10 键」文案）+ alignment EXPECTED_CAPS_KEYS 与两处 len==10 断言 + provider-registry tenKeys + **pre-session-picker.test.tsx 两处 10 键全对象 toEqual 同步（cursor 加 ctx_usage:true / unknown-engine 回退加 ctx_usage:false，「十键」标题改十一键——plan-review P1 连带测试）** + provider-adapter-registry.test.ts 三处「caps 10 键」过时注释顺手同步（P2）；跑生成刷新两端 @generated 产物 |
| task-07 | 前端 CtxUsageBar caps 门控 + 调用点传 provider + vitest | W2 | P0 | task-06 | FR-06, D-001@v1 | provider prop；false 只渲染 QuotaPill；null/未知照常；全仓调用点仅 frontend/src/components/daemon/session-panel/session-panel-page.tsx:2709（preEngine）/ :3501（session.provider） |
| task-08 | onboarding 文档补口径说明 + 真机验证三引擎 | W3 | P0 | task-02,03,04,06 | FR-07, D-001@v1 | spike-01 codex last 验证（结论记 QUICKLOG）+ pi 语义复核 + cursor/pi/codex 环真机冒烟 |

## 关键路径

task-01 → task-04 → task-08（helper → codex 派生（唯一带未实证假设的引擎） → 真机验证收口）

## 全局验收标准

1. daemon：三解析器新派生各带 fixture 断言（ctx_tokens 值 + 缺字段不伪造不编 0）；claude 既有测试全绿（行为零变化实证）；typecheck 绿
2. caps：三端生成产物含 ctx_usage 键（daemon 单源 ↔ frontend ↔ backend 逐值一致）；双守护测试绿；人为抽走 PROVIDER_CAPS 一键 → satisfies/守护测试红（防遗漏实证，verify 阶段演示）
3. frontend：门控三分支 vitest 绿（false 不渲染环 / true 照常 / null 照常）；tsc + eslint 绿
4. backend：alignment 守护测试绿；无其他逻辑改动
5. 真机：codex/pi/cursor 环显示真实百分比（QUICKLOG 回执）；codex last 形态结论落盘
6. （brownfield）旧 daemon / 历史 run（ctx NULL）行为不变：环未知态、REST DTO 零变化、_liftSessionUsage/budget 零影响
7. 集成敏感验收：usage_update 事件携带 ctx_tokens 经 `_eventToReportDict` 平铺 → backend 提取 → SSE tokens 事件全链冒烟（integration-critical 判级要求）

## 覆盖矩阵（如存在 decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01,02,03,04,05,06,07,08 | 全局验收标准 1-7（方案 A 全量：源头派生 + caps 声明 + helper 单源 + 前端门控 + 真机验证） |
