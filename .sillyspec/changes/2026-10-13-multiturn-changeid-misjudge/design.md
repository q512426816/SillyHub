---
author: flow-machine-draft
created_at: 2026-10-13T01:14:30.214Z
---
# 设计记录（Design Record）— 2026-10-13-multiturn-changeid-misjudge

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

`_apply_session_terminal_status`（backend/app/modules/daemon/session/service/helpers.py:147）的多轮判定从 `run.change_id is None` 改为 `session.change_id is None`。依据：`AgentSession.change_id` 语义是"会话本身为 change 而建"（model.py:759，stage 派发在 session/service/create.py:291 写入），而 `run.change_id` 自 2026-10-12-run-level-change-attribution（model.py:767 `current_change_id` 列注释）起被轮级归因给聊天轮打锚，已不再是"会话绑定 change"的可靠信号。线上实证（2026-10-13）：会话 47e2ff1a `session.change_id=NULL` 而 4 轮 run.change_id 全非空，每轮完成后会话被误置 ended；stage 会话 `session.change_id` 非空。改动一个判定锚 + 同步修注释（规则 18），语义等价于恢复归因功能上线前的行为。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `_apply_session_terminal_status(run: AgentRun, session: AgentSession) -> str | None`：签名不变，判定语义变化——多轮锚从 run 级换到 session 级。唯一调用点 close_run_steps.py:477（daemon run 终态回写收口），行为变化仅落在"聊天轮带归因 change_id"这一 2026-10-12 后新增的场景；既有单轮任务 / 群载体（group_carrier 非 interactive）/ 扫描等路径判定结果不变。
- 对外 API / DTO / wire 格式：无变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立——run 终态由 daemon run_sync 回灌，乱序由 D-005 幂等守卫兜底（session 已终态返 None 不覆盖），判定锚换到 session 级不改变该守卫，迟到终态依旧不复活已收口会话。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

同会话并发 run 终态回写沿用既有同事务收口（close_run_steps 单事务），本变更不新增写入路径；session.change_id 由会话创建时一次写入（create.py）、current_change_id 由 run_sync 解析通道回写，二者不同列互不覆盖，判定读 session.change_id 不受 current_change_id 并发回写影响。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全——会话 reopen（status=reconnecting→active）后 session.change_id 保持 NULL（reopen 不写该列），修复后聊天会话每轮完成保持 active，reopen 需求消失；挂起（suspend）路径不经过本函数，不受影响。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会——判定是单会话内存函数，无跨工作区/跨实例共享态；群影子会话（shadow.py:612 strategy="interactive"、session.change_id=NULL）修复后与归因功能上线前行为一致（轮完成保持 active），无串台面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：把"interactive + run.change_id 非空"原本唯一指代的 stage 派发会话误改成 active——已排除：stage 派发会话在 create.py:291 写 session 级 change_id，新锚下仍命中单轮收口（FR-02 场景锁定）；线上验证存在 session.change_id 非空的存量 stage 会话。放弃方案：①按 session_kind/origin=='chat' 判定——线上实证 stage 会话 kind/origin 同为 'chat'（见排查记录），不可区分，弃；②扩展 D-006 豁免表到 completed——治标不治本（completed 本不该进豁免判断），且会误保活真单轮任务，弃；③daemon 侧不给聊天轮打 change_id 锚——归因功能是 2026-10-12 刚上的产品能力，回退损失审计面，弃。
