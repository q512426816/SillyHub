---
author: flow-machine-draft
created_at: 2026-10-13T21:45:30.167Z
---
# 决策记录（Decisions）— 2026-10-14-turn-anchor-cache-eviction

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：清理后同会话被复用（同 id 再打锚）时 prev 恢复依赖 JSONL 尾行读取， 多一次文件读——仅理论场景（终态会话不再有新轮），且与既有重启兜底同路径、已被 既有用例覆盖。试过但放弃：① LRU/条目上限淘汰——引入魔法数与淘汰策略复杂度， 会话终结点清理语义更准确；② clear 同时删 `_chainBySession`——链自身 finally 已 自清理，额外删除无收益反而在同 id 复用时破坏串行链衔接。
