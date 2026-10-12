---
author: flow-machine-draft
created_at: 2026-10-12T06:43:13.857Z
---
# 设计记录（Design Record）— 2026-10-12-run-level-change-attribution

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

问题：一个交互会话先后执行多个变更时，轮级（AgentRun）不带变更锚（inject.py 创建 run 时 change_id 恒 None），聚合口径（usage_service「派发锚点 ∪ 会话锚点」）把绑定会话的全部 run 完整摊给每个绑定变更——列表里每个变更显示同一组会话总和。

方案：参考本地 CLI 水位差分（2026-10-03-local-usage-segment-attribution）的「分段归属」思想，但不在平台侧照抄水位表——平台已有更细的天然单位「轮」（每轮自带 token 四维/按模型明细/耗时），等价做法是轮级打锚：

1. `agent_sessions` 新增 `current_change_id` 列（FK changes.id, SET NULL），语义=会话「当前变更上下文」（最近一次被解析出的 sillyspec 绑定目标）。
2. run_sync 命令解析点（submit_commit，既有 W2.1 通道）在绑会话的同时回写该列；`bind_session_to_change` 改为返回变更 id 供其使用。
3. inject 建轮时 `change_id=session.current_change_id`（一轮一 run 已确认，inject.py:608）。
4. 聚合口径：会话链接分支加 `AgentRun.change_id IS NULL` 谓词——带锚 run 独占归锚定变更，无锚 run 维持现状经链接认领（存量会话全部无锚 → 行为逐字节不变，防回归）。

为什么不用水位表/消息回放：轮已是原子用量单位，打锚即可达到同等拆分效果；水位差分需对会话消息流做序回放，复杂度高收益相同。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `ChangeUsageQueryService` 相关聚合（usage_service.py `_change_run_ids` / `_change_summary_anchor`）：会话链接分支新增 `AgentRun.change_id.is_(None)` 谓词；`ChangeUsageRead`/`UsageSummaryRead` DTO 不变，端点签名不变，**无 API schema 变化（不需 gen:types）**。
- `bind_session_to_change(db, workspace_id, change_key, session_id) -> uuid.UUID | None`：返回类型从 None 改为变更 id（default 守卫跳过/异常时 None）；幂等 upsert、savepoint 不 commit、best-effort 契约不变。既有调用方（platform_sync W2.2）不消费返回值，行为不变。
- `AgentSession` 新列 `current_change_id: uuid.UUID | None`（FK `changes.id` ondelete SET NULL，nullable）+ alembic 迁移 20261012123000（down_revision=c515ffd62859）。
- inject 建轮（`_inject_into_session`）：AgentRun 构造新增 `change_id=session.current_change_id`；create_session 首 run 不动（change_id 由既有派发参数决定）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立边界内成立：同一 run 的 submit 可能多次到达（流式/重试），命令按消息序收集、上下文取最后一条，重放幂等（最后一条不变则结果不变）。旧 run 的迟到重放理论上可能把上下文拉回旧值（如 run N 重放覆盖 run N+2 已写入的 Y）——影响限于统计归属 ≤1 轮偏差，且后续任意新命令自然纠正，接受不设防（与绑定通道既有 best-effort 口径一致）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

同会话轮次有 turn 冲突守卫（单活跃轮），submit 串行；上下文列写在 submit 的既有事务内（与 link 行同 savepoint 事务边界），跨会话互不冲突。一批多条绑定命令按循环序覆盖，最后一条生效（顺序=消息序，确定性）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：会话 reopen 复用同一行，上下文延续（重开后继续同一对话语境，期望行为）；变更被删 → FK SET NULL 清上下文，新轮回落无锚（经链接认领的旧口径）；执行中会话切换目标由「下一条绑定命令」覆盖上下文，无中间态暴露。inject 打锚发生在建轮事务内，失败随事务回滚不落半锚。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会：bind 按（session.workspace_id, change_key）解析变更行，上下文存的是变更行全局 id（FK），不存 key 文本——跨工作区不串台；quicklog（快速修复）聚合不动，本地 CLI 水位差分通道不动（其会话级防双计谓词与本变更无交集）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：口径双轨期混乱——存量会话（如用户 10-10~10-12 那条 665 轮会话）轮上无锚，仍按会话链接全量摊派，与新会话的拆分口径并存。缓解：FR-03 显式冻结存量行为（防回归用例钉死）；仓库规则 11 允许重置开发数据，用户可选择重跑。

试过但放弃：
- 复用 `AgentSession.change_id` 作可变上下文——该列语义是「会话创建时绑定的变更」（派发链写入、会话列表展示消费），拿它当游标会混淆两个含义，且派发会话 change_id 不应被后续命令覆盖；弃。
- submit 时回溯打锚（把 run.change_id 按当轮出现的命令改写）——会把整轮摊给轮中才出现的命令，归属误差方向更差；弃。
- 平台会话水位表（照抄本地机制）——需消息序回放与水位修剪，复杂度高；轮级打锚同效且复用既有原子单位；弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/agent/model.py | AgentSession 新列 current_change_id（FK changes.id SET NULL） |
| 新增 | backend/migrations/versions/20261012123000_add_agent_sessions_current_change_id.py | alembic 迁移（down_revision=c515ffd62859） |
| 修改 | backend/tests/test_align_platform_change_events_migration.py | 迁移链尾锚随新 head 前移（断言面闸门配对钉子） |
| 修改 | backend/app/modules/change/binding.py | bind_session_to_change 返回变更 id（None 兜底） |
| 修改 | backend/app/modules/daemon/run_sync/service/submit_commit.py | 绑定循环后回写 session.current_change_id（最后一条生效） |
| 修改 | backend/app/modules/daemon/session/service/inject.py | 建轮 change_id=session.current_change_id |
| 修改 | backend/app/modules/change/usage_service.py | 会话链接分支 IS NULL 谓词 + 口径 docstring 更新 |
| 修改 | backend/app/modules/change/tests/test_spec_binding.py | 新增返回值契约用例 |
| 修改 | backend/app/modules/change/tests/test_usage_stats.py | 新增拆分/独占/回归护栏用例 |
| 新增 | backend/app/modules/daemon/tests/test_inject_change_context.py | inject 打锚用例 |
