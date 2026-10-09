---
author: flow-machine-draft
created_at: 2026-10-09T15:21:01.746Z
---
# 决策记录（Decisions）— 2026-10-09-daemon-page-stable-sort

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险是排序语义变化对依赖旧行为的调用方的破坏——已排查：前端 runtimes 页及各消费方（工作区概览/悬浮抽屉/移动端）均不依赖机器行序（渲染直接 map），仅 `test_machines_sort_online_first_then_heartbeat_desc` 断言旧序，随本变更同步改写。SQLite（测试）与 PostgreSQL（生产）对 `coalesce` 与多列 ORDER BY 语义一致；provider NULL 的 ASC 排序两方言默认相反（SQLite NULL 在前、PG 在后），故显式 `nulls_last()` 对齐（先例 grants/queries.py:414）。试过放弃的方案：继续按 last_heartbeat_at 排序但前端做二次稳定排序——放弃，双端各排一半、缓存替换时仍会闪跳，且「最近心跳优先」对单用户多机场景无信息量；改按 created_at 排机器——放弃，老机器永远沉底，用户新装机排最前反而难找，展示名升序是唯一可预期口径。
