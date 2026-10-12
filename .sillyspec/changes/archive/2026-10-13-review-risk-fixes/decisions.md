---
author: flow-machine-draft
created_at: 2026-10-12T23:28:08.600Z
---
# 决策记录（Decisions）— 2026-10-13-review-risk-fixes

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险：tail 冲刷行不带 session 三列（`appendSessionWireColumns` 以事件为单位注入，冲刷时刻无源事件可取）——冲刷行仍按 run_id 归属（submit 调用自带 run 维度），session 级 metadata 索引缺列的影响限于一条消息的尾部残片，接受并在 `coalescerFlushAllMessages` 注释记档。次风险：`forwardSubmitMessages` 提取若漏抄任一守卫会改变 handleLine 既有转发行为——以「逐条保留 + 定向测试回归」对冲。 试过但放弃的方案：① coalescer 挂全局单例（跨 attempt 状态泄漏、消息 id 空间不隔离，放弃）；② flushAll 输出复刻 session 三列注入（冲刷时刻无源事件，伪造成分大于收益，放弃）；③ askwait 上限改读 lease 心跳判 daemon 死活（重启瞬间心跳必陈旧，生产实证已否定该判据，维持日志列信号 + 时间上限方案）。
