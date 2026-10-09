---
author: flow-machine-draft
created_at: 2026-10-09T15:01:05.475Z
---
# 提案书（Proposal）— 2026-10-09-daemon-page-stable-sort

## 动机

任务原话转写：守护进程页面（/runtimes）机器卡与机器内 agent 卡每次刷新排序乱跳，要固定排序。
根因（已定位）：后端 list_machines 主查询 ORDER BY last_heartbeat_at DESC（每次心跳都更新，机器间先后随时翻转）；机器内 runtimes 二次查询仅 ORDER BY provider（同 provider 并列时顺序不定）；共享给我的 runtimes 查询同款并列问题。
成功标准：
- /machines 机器列表排序稳定：保留 online 优先，其余改为展示名（coalesce(display_alias, hostname)）升序 + id 兜底，连续多次刷新顺序不变
- 机器内 runtime（agent）列表排序稳定：provider 升序 + created_at/id tiebreaker，同 provider 多 agent 顺序不变
- 共享给我的区块内 runtimes 明细同口径加 tiebreaker
- 新增/扩展后端测试覆盖上述排序稳定性，相关既有测试全部通过

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. /machines 机器列表排序稳定：保留 online 优先，其余改为展示名（coalesce(display_alias, hostname)）升序 + id 兜底，连续多次刷新顺序不变
2. 机器内 runtime（agent）列表排序稳定：provider 升序 + created_at/id tiebreaker，同 provider 多 agent 顺序不变
3. 共享给我的区块内 runtimes 明细同口径加 tiebreaker
4. 新增/扩展后端测试覆盖上述排序稳定性，相关既有测试全部通过

## 成功标准（可验证）

1. /machines 机器列表排序稳定：保留 online 优先，其余改为展示名（coalesce(display_alias, hostname)）升序 + id 兜底，连续多次刷新顺序不变
2. 机器内 runtime（agent）列表排序稳定：provider 升序 + created_at/id tiebreaker，同 provider 多 agent 顺序不变
3. 共享给我的区块内 runtimes 明细同口径加 tiebreaker
4. 新增/扩展后端测试覆盖上述排序稳定性，相关既有测试全部通过
