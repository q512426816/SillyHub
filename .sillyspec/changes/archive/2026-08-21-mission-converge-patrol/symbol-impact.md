---
author: qinyi
created_at: 2026-08-21 07:40:00
---

# 符号影响面：mission 收敛巡检

> 每 task 一行结论；签名级变更 = 构造函数参数/接口/DTO/方法签名增删改。

- task-01：无签名级变更（Settings 纯追加 4 个 Field，无既有字段改动）。
- task-02：新增符号（MissionPatrolService 类 + run_once/loop/_active_mission_ids 方法 +
  模块级 mission_patrol_loop），无既有签名变更。
- task-03：无签名级变更（patrol.py 内部实现追加，消费既有
  OrchestratorService.schedule_loop(mission_id) -> str | None 原签名）。
- task-04：无签名级变更（消费既有 redispatch_pending_main_runs() -> int 原签名）。
- task-05：新增 patrol 内部方法（判死链路查询 + 标记写入），无既有签名变更；
  写 AgentMission.constraints JSON 新键 zombie_marked_at（数据键非签名）。
- task-06：无签名级变更（复活路径复用 render_orchestrator_prompt + dispatch_to_daemon
  既有签名；AgentRun 状态翻回为数据变更非签名）。
- task-07：无签名级变更（constraints 新键 zombie_converged）。
- task-08：无签名级变更（schedule_loop 签名不变，内部新增 zombie 豁免分支——
  对 error_code == "orchestrator_zombie" 的新值路径，既有调用方
  run_sync._handle_team_run_completion 行为零变化）。
- task-09：无签名级变更（main.py lifespan 纯追加 create_task 接线）。
- task-10：无签名级变更（文档 + 回归）。
