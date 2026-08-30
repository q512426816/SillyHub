---
author: qinyi
created_at: 2026-08-24 19:25:00
---

# 符号影响面报告（Symbol Impact）— 2026-08-24-session-team-mission-context

> 逐 task 签名级变更结论（execute「加载上下文」步硬门）。判定基准：构造函数参数/接口/DTO/方法签名增删改 = 签名级；函数体内部实现变化不算。

| task | 签名级变更 | 受影响调用点 | 是否在任务范围内 |
|---|---|---|---|
| task-01 | 新增 3 个模块级函数签名：`collect_scope_workspace_statuses(mission, session, *, git_probe=None)`、`render_scope_brief(...)`、`render_session_orchestrator_briefing(...)`（全新增，无既有签名变更）；`render_orchestrator_prompt` **签名不变**（内部改调共享函数） | `render_orchestrator_prompt` 既有调用点 patrol.py:622、orchestrator.py:393/:483（签名不变零影响）+ 新函数消费方 task-03/06/08/09/10 | 是（新函数属本任务产出） |
| task-02 | 新增 async 方法签名：`HostFsDelegate.probe_workspace_git_mode(workspace) -> str`（纯新增；既有 9 方法零签名变更） | 新消费方 task-03/05/10；无既有调用点 | 是 |
| task-03 | 新增路由函数与 2 个 DTO（`ScopeWorkspaceStatus`/`MissionStatusResponse`）；**WorkerListItem 定义位置迁移**（mcp_tools.py:162 → agent/schema.py，mcp_tools 保留模块级重导出——from-import 兼容，消费方零改动） | `from app.modules.agent.mcp_tools import WorkerListItem` 的既有消费方（重导出兜底零影响）；daemon hub-client 走 HTTP 不受影响 | 是（迁移+重导出在本任务 allowed_paths 内） |
| task-04 | 新增内部 helper 签名（如 `_precreate_mission_flush`，名称实现期定）；`team_mission_entry` **公开签名与 (mission, main_run\|None) 返回契约不变**（内部重构） | trigger 端点（daemon/router.py:2428+）、懒建（mcp_tools.py:474）、external（SillySpec execute 链路）——签名不变零改动 | 是 |
| task-05 | `render_worker_prompt` **签名变更**：新增可选 mode 参数（keyword-only，缺省=既有行为，向后兼容）；`dispatch_worker` 签名不变（内部分流） | `render_worker_prompt` 调用点 execution.py:332（唯一，范围内）+ 既有测试 | 是 |
| task-06 | 新文件 3 个函数签名（`should_inject_first_turn_briefing`/`build_orchestrator_briefing`/`resolve_first_turn_briefing`，纯新增） | 新消费方 task-08/09 | 是 |
| task-07 | **DTO 字段级新增**：`SessionCreateRequest` 加可选 `team_mission: TeamMissionCreateBlock \| None`（缺省 None；pydantic 忽略多余字段→旧请求体零影响）；新增 `TeamMissionCreateBlock` DTO；新增共享校验函数 `validate_team_mission_block`；trigger 端点签名不变 | SessionCreateRequest 消费方：daemon/router.py create 端点（task-09 透传）、frontend daemon.ts createSession（task-13 类型扩展） | 是 |
| task-08 | 无签名级变更（`_inject_into_session` 内部 prompt 组装变化；SESSION_INJECT payload 协议字段不变仅内容） | 无调用点影响 | — |
| task-09 | **`create_session` 签名变更**：新增可选 keyword 参数 `team_mission`（缺省 None 向后兼容）；create 端点（router.py:2014-2025）签名不变、body 消费扩展 | create_session 调用点：daemon/router.py create 端点（本任务内透传）；无其它调用方 | 是 |
| task-10 | 新增路由函数 + `WorkspaceProbeRequest`/响应项 DTO（纯新增） | 新消费方 task-12（HTTP）；无既有调用点 | 是 |
| task-11 | TS 新增：mcp-server.ts 工具注册 `mission_status` + hub-client.ts 方法 `getMissionStatus`（纯新增，不动既有 5 工具与方法签名） | 新消费方：主控 agent（MCP）；无既有调用点 | 是 |
| task-12 | **接口字段级新增**：`TeamTriggerPopoverProps` 加可选 `preSession?: boolean`（缺省 false 向后兼容）；确认 payload 类型交集扩展（组件内局部类型） | TeamTriggerPopover 挂载点 session-panel.tsx:2008/:3254（缺省值零影响）+ task-13 preSession 实例传参 | 是 |
| task-13 | daemon.ts `createSession` 参数类型扩展（可选字段 team_mission，向后兼容）+ 可能新增 `probeWorkspaces` 导出；session-panel.tsx 内部接线（无导出签名变更） | createSession 调用点：session-panel 两处（范围内） | 是 |
| task-14 | 无签名级变更（测试新增 + api-types/openapi 再生成——生成产物含新类型属前序任务已定契约 + 模块文档） | gen:types 产物消费方（frontend/daemon 编译期） | — |
