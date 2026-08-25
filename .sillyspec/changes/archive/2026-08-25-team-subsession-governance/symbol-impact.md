# 符号影响面报告

> tasks.md 内容指纹（生成时）: 9b79aff1282da157——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——AgentSession 加 nullable 列不改既有构造/方法签名；新增符号 mission_worker_sessions/resolve_mission_for_session（新函数，无既有调用点，消费方 task-05/07/09/10/11/13 在任务范围内）
- task-02: 无签名级变更（对外）——execution.py 内部抽共享 worktree helper（模块内私有重组），MissionExecutionService.dispatch_worker 对外签名不动；既有调用点 mcp_tools/bootstrap 不受影响
- task-03: 签名级变更——prepare_interactive_dispatch 追加可选参数（stage/pinned_runtime_id/pinned_skip_owner_check，默认值零回归）；既有调用点 daemon/session/service.py create_session 不传新参行为不变，新参消费方 task-05/06 在范围内
- task-04: 签名级变更——create_session 追加可选参数（parent_session_id/first_run_mission_id/first_run_role 等，默认零回归）；既有调用点 daemon/router.py create 端点不传新参不变；mission_context 新增 build_worker_briefing 为新符号
- task-05: 无签名级变更——_dispatch_worker_core 对外端点响应（WorkerRunResponse）不变，执行段内部换三元组；batch 路径 MissionExecutionService.dispatch_worker 保留服务 bootstrap 等既有调用点
- task-06: 签名级变更（daemon）——cli.ts isMainAgentSession 谓词语义三态化（mission_worker 由排除改受限注入）；mcp-server.ts 工具注册按 env 门控裁剪（六处 registerTool 行为分支）；session-manager 注入点新增分身分支不改 _resolveMainAgentMcp 既有签名
- task-07: 无签名级变更——mcp_tools 新增 worker_done 端点与 DTO（新符号）；mission_context 新增 DEL helper（新符号）；不动 notify_orchestrator_workers_done 既有签名
- task-08: 无签名级变更——mission.py 新增 is_worker_complete/mission_derive_status（新符号）；derive_status 纯函数签名不动（D-005@v1）
- task-09: 调用点级变更——_converge_core/schedule_loop/_team_mission_summary/_mission_status_core/workers_all_terminal_with_stats/cleanup_mission 六处换调 task-08 新函数；被改函数自身签名均不变
- task-10: 无签名级变更——finalizer 内部新增沿树收口；消费 SessionService.end_session 既有签名（系统触发路径经内部调用，不改 owner 校验签名）
- task-11: 无签名级变更——can_dispatch_worker 返回结构 (allowed, reason) 不变仅内部口径扩展；cost_from_runs 输入扩展；cancel kill 名单扩展（内部实现）
- task-12: 无签名级变更——patrol 新增职责⑤孤儿子会话扫描（新函数），既有四职责签名不动
- task-13: DTO 字段级变更——TeamMissionWorkerSummary 追加 sub_session_id/first_run_id（nullable 可选）；消费方前端经 gen:types 再生成 api-types.ts（范围内同步提交 openapi.json）；_team_mission_summary workers 数据源内部换子会话行
- task-14: 签名级变更（组件 props）——team-task-block 追加可选回调 onOpenWorkerSession（默认不传零回归）；消费 session-panel 既有 props 不变
- task-15: 无签名级变更——纯测试新增与预期行为变更的既有断言更新（CLAUDE.md 规则 9 边界内）
