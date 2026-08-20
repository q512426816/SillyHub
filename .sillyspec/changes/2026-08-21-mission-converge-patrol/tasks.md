---
author: qinyi
created_at: 2026-08-21 06:05:00
---

# 任务清单：mission 收敛巡检

> 状态标记：`[ ]` 待办 / `[x]` 完成 / `[~]` 进行中。执行阶段逐项更新。

## Wave 1：基础层

- [ ] task-01：Settings 四项配置（core/config.py：enabled/interval/zombie_after/revive_window，
  Field 约束 ge=10/ge=5/ge=5，中文注释）。验收：单测读取默认值 + 越界校验。
- [ ] task-02：patrol.py 骨架（MissionPatrolService：巡检循环 + 活跃 mission 查询
  limit100 + 逐 mission try/except 隔离 + round_done 结构化日志）。验收：单测循环
  退出（enabled=False）/ 异常隔离 / 查询过滤（cancelled/converged 排除）。

## Wave 2：三职责

- [ ] task-03：收敛兜底接线（每轮对活跃 mission 调 schedule_loop，统计 converged 计数）。
  验收：mock OrchestratorService.schedule_loop 断言逐个调用；返回非 None 计数。
- [ ] task-04：离线重派接线（调 redispatch_pending_main_runs，统计 redispatched）。
  验收：mock 断言调用 + 返回计数透传。
- [ ] task-05：僵尸判死（主 run running+有 lease → 最新 lease → runtime → daemon；
  status!=online 且 last_heartbeat_at 距今≥阈值 → failed+orchestrator_zombie+
  finished_at+constraints.zombie_marked_at；幂等判重）。验收：三分支单测
  （超阈值判死/在线不动/未超阈值不动）+ 幂等（已 zombie 不重复标）。
- [ ] task-06：僵尸复活（error_code=orchestrator_zombie + 窗口内 + daemon 恢复 online
  → running+清标记+重渲染 prompt+dispatch_to_daemon；重派失败回滚 zombie 态不丢）。
  验收：复活分支单测 + 重派失败保持 failed(zombie) 单测。
- [ ] task-07：豁免解除（窗口耗尽 → constraints.zombie_converged=true，不再干预）。
  验收：窗口耗尽单轮标记、下轮信号 1 可收敛。

## Wave 3：schedule_loop 豁免 + 接线

- [ ] task-08：schedule_loop 信号 1 zombie 豁免（主 run error_code=orchestrator_zombie
  且 zombie_marked_at 距今 < revive_window → return None 不收敛；豁免只对新 error_code
  生效，既有调用方零回归）。验收：test_orchestrator.py 追加豁免窗口内/耗尽两用例 +
  既有用例全绿。
- [ ] task-09：main.py lifespan 接线（create_task + yield 后 cancel/gather，
  enabled=False 不启动）。验收：接线冒烟测试。

## Wave 4：集成回归

- [ ] task-10：全量回归（agent + daemon 模块 pytest；ruff/mypy）+ 模块文档
  backend.md MANUAL_NOTES + 审查报告"登记不做"章节状态更新。
