---
author: flow-machine-draft
created_at: 2026-09-29T00:29:03.961Z
---
# 决策记录（Decisions）— 2026-09-29-jump-empty-turn-dup

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：把「日志在窗口外」误判为「零正文」导致内容永不加载——不会发生：判定基于本次 run_id 直达拉回的**全量** run 日志（该请求不受游标窗口限制），拉回有正文即照旧 prepend；仅拉回全空才标记。试过放弃的方案：①「turn 在 turnState 存在即视为已加载不再拉」——孤儿空壳（displayTurns 补建/翻页空壳）不在 turnState 或因陈旧闭包查不到，且壳轮的日志可能在已加载窗口之外、首点必须拉，存在性判定会弄丢首次加载机会；②「扩 loadedHasBody 判定条件」——治标不治本，陈旧闭包（deps 无 turnState）下二次点击依旧查不到首次 prepend 的轮。ref 标记不受闭包影响，是稳态判定。实证：stash 掉修复跑新用例红（expected 2 to be 1——二次点击重复直达），恢复后绿。
