---
author: qinyi
created_at: 2026-08-19 09:44:00
scale: large
---

# 任务清单：跨工作区团队执行 + 项目维度会话

> 任务分组为建议 Wave，正式 Wave 排序由 plan 阶段产出（`sillyspec run plan`）。

## W1 数据模型与派发路由（backend 核心）

- task-01：migration 20260819100000（agent_missions 加 project_id + scope_workspace_ids；agent_runs 加 target_workspace_id）+ model.py 字段声明
- task-02：member_runtimes/queries.py 增 resolve_representative_binding（owner 在线优先 → 任意在线按 daemon 最近心跳）+ 单测三分支
- task-03：placement.py `_resolve_dispatch_runtime` 增 representative_fallback 旗标（旗标开走代表 binding；旗标关字节级维持 borrow 现状）+ 借用零回归测试（验收 9）
- task-04：execution.py dispatch_worker target_workspace_id 路由（effective_target 贯穿 worktree/provider/placement + 传旗标 + run 落列 + no_binding_for_workspace 失败路径）

## W2 mission 域与编排（backend）

- task-05：mission_schema.py 扩展（Create 加 anchor/scope；Response 加 project/scope/ws 概要；WorkerRun 加 target 概要）
- task-06：OrchestratorService.team_mission_entry scope 形参 + render_orchestrator_prompt 项目上下文注入（项目名 + scope 清单 + target 用法）
- task-07：agent/router.py 新增 POST/GET /projects/{pid}/missions（scope 校验 + PPM 项目经理鉴权 + binding 预检）+ create_mission scope 形参 + 单测（验收 2）

## W3 MCP 双通道对齐（backend + daemon）

- task-08：mcp_tools.py（链路A）——_get_mission scope 放宽（NULL 按 [anchor]）+ dispatch_worker target 参 + scope 校验 + profile 归属放宽（P2-1）
- task-09：mcp_gateway/tools.py（链路B）同款对齐 + converge 兜底路由旗标（D-010，验收 8）
- task-10：sillyhub-daemon src/mcp-server.ts dispatch_worker schema 加 target_workspace_id 透传 + vitest（验收 7）

## W4 收敛分组（backend）

- task-11：finalizer.py merge 分组改造（(target or anchor, branch) 二元组分组 resolve + 冲突按组独立，验收 5 前半）
- task-12：finalizer.py cleanup_mission 分组（D-011，验收 5 后半副本清理断言）

## W5 前端 + 类型（frontend）

- task-13：pnpm gen:types（node_modules 健康预检）+ 提交 api-types.ts + openapi.json
- task-14：lib/agent.ts createProjectMission/listProjectMissions + 类型
- task-15：/projects/[id]/missions 页面（发起表单 anchor/scope 圈选 + MissionConsole 复用扩展 worker 目标工作区列）+ 组件测试

## W6 收尾

- task-16：单 ws mission 全链路零回归集成测试（验收 1）+ 全量 pytest/vitest 跑绿 + 文档更新（模块卡 agent/workspace、flows/mcp-worker-dispatch 若涉）
- [x] ql-20260819-002-4c90 提案：跨工作区团队执行 + 项目维度会话
