---
author: qinyi
created_at: 2026-08-21 06:05:00
---

# 任务清单：mission 收敛巡检

> 状态标记：`[ ]` 待办 / `[x]` 完成 / `[~]` 进行中。执行阶段逐项更新。
> 任务分组（Wave）与依赖见 plan.md；本文件是任务注册表唯一真相。

- [x] task-01: Settings 四项配置（enabled/interval/zombie_after/revive_window + Field 约束 + 默认值单测）(depends_on: —)
- [x] task-02: patrol.py 骨架（巡检循环 + 活跃查询 limit100 + 异常隔离 + round_done 日志 + 每轮短 session + enabled=False 退出）(depends_on: —)
- [x] task-03: 收敛兜底接线（每轮对活跃 mission 调 schedule_loop，converged 计数）(depends_on: task-02)
- [x] task-04: 离线重派接线（调 redispatch_pending_main_runs，redispatched 计数透传）(depends_on: task-02)
- [x] task-05: 僵尸判死（项目维度限定；running+有 lease+daemon 持续离线超阈值→failed(zombie)+zombie_marked_at；链路断链跳过；幂等判重）(depends_on: task-02)
- [x] task-06: 僵尸复活（窗口内 daemon 恢复→running+清标记+重渲染 prompt 重派；重派失败回滚 zombie 态）(depends_on: task-05)
- [x] task-07: 豁免解除（窗口耗尽→constraints.zombie_converged=true）(depends_on: task-05)
- [x] task-08: schedule_loop 信号 1 zombie 豁免（窗口内 return None；信号 3 不豁免；既有调用方零回归）(depends_on: task-05)
- [x] task-09: main.py lifespan 接线（create_task + cancel/gather；enabled=False 不启动；接线行为以 patrol 循环函数单测验证，不依赖 lifespan 冒烟）(depends_on: task-02,03,04,05,06,07,08)
- [x] task-10: 全量回归 + 文档（pytest agent+daemon / ruff / mypy / backend.md 备注 / 审查报告登记项更新）(depends_on: task-09)
