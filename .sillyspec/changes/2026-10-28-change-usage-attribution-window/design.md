---
author: flow-machine-draft
created_at: 2026-10-28T05:47:18.650Z
---
# 设计记录（Design Record）— 2026-10-28-change-usage-attribution-window

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

双管齐下堵「变更执行用量取大」：**统计侧时间窗**（`usage_service.py` 聚合 SQL 加窗口谓词）让存量虚高显示自动回落，**源头终态清锚**（`binding.py` 终态命令识别 + `submit_commit.py` 清 current_change_id）防未来继续污染。

统计侧：linked 分支（会话链接认领无锚 run）加三道谓词——下界（run.started_at ≥ link.created_at，绑定前历史轮不摊）、归档上界（run.started_at ≤ change.archived_at，归档后不计）、最近绑定防双计（同会话有更新变更 link 时轮归新变更）；dispatched 分支（run.change_id 直锚）仅加归档上界（保 backfill 存量回填语义，无下界）。选统计侧而非改数据：窗口全在查询里，生产数据零触碰即自愈。

源头侧：`extract_spec_bindings` 对 `run archive` / `flow done` 两族终态命令产出 terminal 标记，submit 通道据此把会话 current_change_id 置 NULL——此后同会话新轮无锚，不再计入已终态变更。配套 `bind_session_to_change` 新增 effective_from：link.created_at 回填本轮 run.started_at（绑定自本轮生效），防下界误伤执行绑定命令的立项轮自身。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `ChangeUsageQueryService._link_window_predicates(change_alias)`（新增静态方法）：三道窗口谓词，被 `_change_run_ids`（详情）与 `_change_summary_anchor`（列表摘要）两处消费——两入口口径恒一致。
- `ChangeUsageQueryService._change_run_ids` / `_change_summary_anchor`：dispatched 分支 join Change 加归档上界；linked 分支 join Change + 三道窗口谓词。
- `SpecCommandBinding.terminal: bool = False`（新增字段，frozen dataclass）：run archive / flow done 为 True，其余绑定命令 False。
- `extract_spec_bindings`：解析逻辑不变（族/段首收紧/quick 跳过/default 守卫全保持），仅补 terminal 标记。
- `bind_session_to_change(..., effective_from: datetime | None = None)`（新增可选参数）：新插 link 的 created_at 取值；None 用当前时刻（platform_sync / 会话创建落绑定两调用方行为不变）。
- `submit_commit.py` 绑定循环：terminal → current_change_id = None（清锚）；非 terminal bind 成功 → 游走覆盖（原行为）。
- 对外 API 端点 / DTO / 前端类型：**无变化**（usage 端点返回结构不变，仅数字口径修正，无需 gen:types）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. **乱序/迟到到达**：run 消息乱序落库时 started_at 为轮真实开始时刻（不随落库序漂移），窗口判定稳定；started_at NULL 的 run 放行计入（保守不丢数）。水位/快照通道（本地 CLI 段）不经本窗口，不受影响。
2. **并发写**：link 幂等 upsert（unique 兜底并发），effective_from 只在首插生效、重复 bind 不回写已有关联的 created_at；两个执行体同时 bind 同对 (change, session) 至多一行 link。清锚与游走同批按消息序最后一条生效，与原游走语义一致。
3. **切换/生命周期**：flow done 清锚后 amend-draft（返工）会重新 bind 游走回该变更，锚恢复；变更归档后清锚漏网（如顶层别名 archive 命令不解析）由统计侧 archived_at 上界兜底，显示口径仍正确。中途崩溃：窗口谓词在查询侧无状态，无半态风险。
4. **作用域**：窗口谓词全部锚定同一 change/link 行（join 限定 change_id / session_id），跨工作区变更各自独立窗口，无串台；「最近绑定」NOT EXISTS 仅查同会话 link，不跨会话影响。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：**link.created_at 存量语义混合**——本变更上线前的存量 link 行 created_at 是「落库时刻」（晚于立项轮开始），下界会漏计存量变更的立项轮（少算一轮，方向安全）；上线后新 link 回填轮 started_at 无此问题。次风险：change_session_links 表无 session_id 前导索引，「最近绑定」NOT EXISTS 子查询在生产量级下可能走全表（行数=绑定对数，量级小，先接受，性能留观）。

死路（试过放弃）：a) backfill 批量改锚修数据——不可逆且「归档后打锚轮」归档前可能确属该变更，机器无法区分；b) 下界用 change.created_at 或落库 now——立项轮 started_at 早于两者，误伤立项轮（effective_from 方案解决）；c) 解析器扩认顶层别名 `sillyspec archive`——破坏样例库既有「防字面误归」契约（会话 5f088f10 幽灵实证），归档上界已兜底显示口径。
