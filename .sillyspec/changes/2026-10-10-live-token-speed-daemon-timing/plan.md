---
plan_level: full
execution_mode: main
---

# 实现计划（Plan）：运行中实时 tok/s——daemon 逐调用计时管线

## Spike 前置验证

无（三引擎计时锚点均已经子代理调研 + Grill 审查核实到 file:line，无未验证集成）。

## Wave 1（契约根基）
- task-01

## Wave 2（三引擎计时，文件正交）
- task-02
- task-03
- task-04

## Wave 3（backend 摄取，依赖 Wave1 契约键）
- task-05

## Wave 4（前端接线，依赖 Wave1 契约键；与 Wave3 文件正交）
- task-06

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR | 说明 |
|---|---|---|---|---|---|---|
| task-01 | daemon usage 契约扩展（类型+schema+透传） | W1 | P0 | — | FR-04 | AgentEventUsage += api_duration_ms；schema 放行；usageToEventUsage 守卫 |
| task-02 | claude 桶计时 + flush 搭车 | W2 | P0 | task-01 | FR-01 | message_start 锚/折叠 + message_delta 活刷新 + result 折叠残段 |
| task-03 | codex 生成窗口计时 | W2 | P0 | task-01 | FR-02 | item/started→completed(agentMessage\|reasoning) 窗口累计 |
| task-04 | pi message_end 折叠 | W2 | P1 | task-01 | FR-03 | 含显式降级路径（无内容锚则不接并留档） |
| task-05 | backend 摄取与下发 | W3 | P0 | task-01 | FR-05, FR-06 | max 累积 + 仅增不减写回 + tokens/summary 增键 |
| task-06 | 前端接线与门控放宽 | W4 | P0 | task-01 | FR-07 | onTokens 写入 + turnTokenSpeedText 任意状态双值即显示 + 测试改写 |

## 关键路径

task-01 → task-02 → task-05 → task-06（claude 主链最长，决定交付周期；task-03/04 与 task-02 并行）。

## 全局硬约束（从 design.md 逐字绑定所有 task）

- 分母只含模型生成窗口，工具执行时间禁止计入；折叠负值钳 0、无锚不折叠。
- 数据不可得如实不显示：禁止墙钟估速充数、禁止伪造 0；cursor v1 不接。
- None 不带键：usageToEventUsage 缺省不带键；publish tokens/summary 在 intent 值 None 时禁止带 duration_api_ms 键。
- close_run_steps.py 覆盖守卫（if duration_api_ms is not None）零改动；submit_commit 写回仅增不减（与 DB 现值取 max，防跨轮回退——Grill P2 采纳）。
- 旧 daemon/旧前端/旧 backend 双向兼容零影响（缺键即无速度显示）。
- 引擎打点用 Date.now()，测试经 fixture 流 + 可控时钟（vi.useFakeTimers 或注入），禁止 sleep 真等。

## 全局验收标准

1. daemon 三引擎新增/改写测试全绿（claude-events / codex-app-server-driver / pi-rpc-driver 既有测试文件内新用例）。
2. backend 触及测试文件全绿（submit 提取/写回、publish 下发键）。
3. frontend turn-speed / turn-timeline-token-speed 测试改写后全绿 + pnpm typecheck 零错 + pnpm exec tsc 相关文件无类型债（教训：禁止 tail 截断掩盖多行错误）。
4. brownfield：无计时数据的引擎/旧数据行为与上变更完全一致（不显示速度）。
5. 不跑全量测试套件（CI 职责）。

## 覆盖矩阵

无 decisions.md——决策已并入 design（风险与死路/自审节）；FR→task 映射见上方任务总表「覆盖 FR」列。
