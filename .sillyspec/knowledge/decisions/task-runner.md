# 决策知识 — task-runner

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-review-risk-fixes
锚点：未记录
最近确认：4caba5b215fd2dc2147694f0afaf9aec48ce936d
理由：答：最大风险：tail 冲刷行不带 session 三列（`appendSessionWireColumns` 以事件为单位注入，冲刷时刻无源事件可取）——冲刷行仍按 run_id 归属（submit 调用自带 run 维度），session 级 metadata 索引缺列的影响限于一条消息的尾部残片，接受并在 `coalescerFlushAllMessages` 注释记档。次风险：`forwardSubmitMessages` 提取若漏抄任一守卫会改变 handleLine 既有转发行为——以「逐条保留 + 定向测试回归」对冲。 试过但放弃的方案：① coalescer 挂全局单例（跨 attempt 状态泄漏、消息 id 空间不隔离，放弃）；② flushAll 输出复刻 session 三列注入（冲刷时刻无源事件，伪造成分大于收益，放弃）；③ askwait 上限改读 lease 心跳判 daemon 死活（重启瞬间心跳必陈旧，生产实证已否定该判据，维持日志列信号 + 时间上限方案）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-spawn-flush-e2e-test
锚点：未记录
最近确认：771c8ad8e9e4a1dcbc16ce27c64700ae0865c4b5
理由：答：最大风险：时序脆弱——若固定 tick 不足以让 readline 消费推送行（慢 CI），「零直发」断言可能偶发红。对冲：tick 取 25ms（既有测试同量级）且断言面宽松（只断言批次数与内容，不依赖帧级时序）；看门狗用例等待窗 3 倍于触发时间。次风险：`vi.mock('node:child_process')` 文件级替换影响同文件后续 import——同 tests/task-runner.test.ts 先例，本文件独立无其它 spawn 依赖。 试过但放弃的方案：① 经 `runner.runLease` 全链驱动（含 lease claim/心跳编排，时序面大、断言噪声多，且 runLease 已有专属测试，放弃）；② 给 spawnAndStream 加依赖注入 seam 以便绕过 spawn（为测改产线签名，违背「纯测试新增」边界，放弃）。
