---
author: flow-machine-draft
created_at: 2026-10-23T07:45:55.362Z
---
# 决策记录（Decisions）— 2026-10-23-session-first-load-ux

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：第二段 prepend 合并的轮块拼装正确性（锚点轮直达段与底窗同 run 跨块、#e 变体 key、游标推进条件）——缓解：合并逻辑提炼为纯函数（输入：已渲染 turns、底窗行集、adaptive 结果；输出：prepend 轮块数组 + 新游标），单测覆盖跨 run/同 run/空补拉/整体回退四种形态；沿用「加载更早」已验证的拼接语义而非新造。 已放弃方案： - 「底窗后立即建 SSE 流」：直达整轮可能带回底窗边界之外的行，cursor 语义需重推导（现版注释明确「游标不前进会重复拉取」），风险大于收益——建流时序保持不变。 - 「取消/砍掉 buildInitialWindow 恢复纯底窗」：回退 first-window-turn-align 的轮对齐目标（轮首被截的困惑回归），治标不治本。 - 「补拉自动连翻触顶翻页（maybeAutoFill 循环）替代直达链」：串行多页 RTT 比并行 8 轮慢，且首屏先闪半轮再补全跳变更丑。
