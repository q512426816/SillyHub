# 决策记录 — 2026-10-28-change-usage-attribution-window

## D-001 统计侧时间窗，不做数据修正
**选定**：聚合 SQL 加归因时间窗（linked 三道谓词 + dispatched 归档上界）。
**落选**：backfill 改锚（批量 UPDATE agent_runs.change_id / 删 link）。
**理由**：统计侧让存量虚高显示（如 2026-10-28-session-list-loadmore-fetch 的 3.3 小时/636 轮）部署后**自动回落**，无需触碰生产数据；改数据不可逆且「归档后打锚的轮」在归档前可能确属该变更（无法机器区分）。

## D-002 下界锚点 = link.created_at（bind 回填轮 started_at）
**选定**：`bind_session_to_change` 新增 `effective_from`——run_sync 命令解析通道传**本轮 run 的 started_at**，link.created_at 即「绑定自本轮起生效」。
**落选**：a) 落库时刻 now——flow start 命令在轮内执行、轮开始早于命令落库，下界会误伤立项轮自身；b) change.created_at——placeholder 建立也可能晚于轮开始，同样误伤，且多会话各自绑定时刻不同、无法按对开窗。
**边界**：`started_at IS NULL` 的 run 放行（时间缺失不判窗、保守计入防存量丢数）；幂等 bind 不回写已有 link 的 created_at（首建时刻即生效时刻）。

## D-003 清锚只认「带 --change 的终态命令」，其余靠统计侧兜底
**选定**：解析器对 `sillyspec run archive --change X` 与 `sillyspec flow done --change X` 产出 `terminal=True`，submit 通道据此清 `current_change_id`。
**落选**：扩解析范围认顶层别名 `sillyspec archive --change X`——样例库既有契约明确无产出（防字面误归，会话 5f088f10 幽灵实证），改契约会破既有守卫。
**兜底**：归档命令常不带 `--change`（上下文模式）或走顶层别名——这些形态清锚不触发，但归档完成后 `change.archived_at` 有值，统计侧归档上界把其后一切轮排除，显示口径仍正确。清锚的价值在锚数据干净与非统计消费方（git_status 推 worktree 等）。

## D-004 submit 层清锚不写重集成测试
**理由**：`st.sillyspec_commands` 绑定循环无既有单测先例（grep 仅生产代码引用），模拟 submit 管线成本高；清锚逻辑三行，语义被解析层（terminal 标记 10 用例）与 bind 层（effective_from 3 用例）单测锁定；统计侧另有 7 用例窗口覆盖。

## D-005 quicklog 侧本次不动
`_quicklog_run_ids` / `quicklog_session_links` 存在同构「绑定前摊入」理论问题，但 quick 通道已删除（CLAUDE.md 规则 19）、条目无 archived_at 终态概念、无新数据产生；如确需收口另起变更。

## D-006 platform_sync 归因旧债顺手修
test_agent_log_attribution 三个既有失败（stash 验证与本变更无关）：无日期前缀 change_key（`repush-ctx` 等）被 2026-10-27-ghost-spec-binding-fix 守卫拒建 placeholder。按「无关旧测试债顺手修」惯例给测试 key 加日期前缀（`2026-10-28-` 前缀），断言同步。

## D-007 「最近绑定防双计」按 link 对（change, session）判定
单会话多变更：无锚轮归「轮时刻最近绑定的变更」（NOT EXISTS 同会话更新 link 且不晚于轮开始）。多变更窗口重叠（前一变更未归档、后一变更已绑定）时旧变更不再吃新时段的轮。带锚 run 不受此约束（锚=明确归属，独占）。
