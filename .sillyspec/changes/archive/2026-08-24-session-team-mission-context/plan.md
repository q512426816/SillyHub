---
author: qinyi
created_at: 2026-08-24 17:15:00
plan_level: full
---

# 实现计划（Plan）— 会话团队任务上下文贯通

## Spike 前置验证

无——五层机制全部有源码实证（Design Grill 已核：前导先例 service.py:910-920、路径A 语义 execution.py:238-243、finalizer 过滤 :290-297/:470-477、非降级通道 delegate.py:657、stat 路径守卫 host-fs-handler.ts:455-457、flush-only 事务边界 service.py:1008/:1011 + orchestrator.py:330-332）。无技术不确定性，不需要 Spike。

## Wave 1（并行，无依赖）
- task-01
- task-02

## Wave 2（依赖 Wave 1）
- task-03
- task-04
- task-05
- task-06
- task-07

## Wave 3（依赖 Wave 2）
- task-08
- task-10
- task-11

## Wave 4（依赖 Wave 3）
- task-09
- task-12

## Wave 5（依赖 Wave 4）
- task-13

## Wave 6（依赖 Wave 5）
- task-14

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 共享 scope 查询+渲染函数（orchestrator.py） | W1 | P0 | — | FR-01, D-004@v1 | 新增 `collect_scope_workspace_statuses`（结构化：ws+任一成员 binding+daemon 在线+可选探测）与 `render_scope_brief`（文本，git_probe 可选回调不传则省略模式字段）、`render_session_orchestrator_briefing`；`render_orchestrator_prompt` 改调共享函数（patrol 输出结构等价+新增机器名，不引入探测） |
| task-02 | 非 git 三态探测 helper（delegate.py） | W1 | P0 | — | FR-04, D-006@v2 | `probe_workspace_git_mode`：非降级 RPC 通道（_via_rpc 语义，transport 失败抛异常）发 host_fs.stat，**绝对路径** `resolve_root_path_for_daemon(ws.root_path)+"/.git"`；exists=True→git / 真答 False→direct / 异常+HostFsDelegateUnavailable→unknown |
| task-03 | mission_status backend 路由+DTO | W2 | P0 | task-01,02 | FR-02, D-005@v1, D-012@v1 | mcp_tools.py 路由 **`GET /missions/status`（X-Session-Id header 定位，实际路径 /api/missions/status——对齐 hub-client `_missionActionPath` missionId 缺省形态 hub-client.ts:428-437；sessions/{sid} 变体可选三族同构）** + agent/schema.py `MissionStatusResponse/ScopeWorkspaceStatus`；直接 `get_active_mission_for_session` 定位（不走 _resolve_session_mission）；无活跃→{active:false,hint} 200；workers 复用 _list_workers_core |
| task-04 | team_mission_entry flush-only 重构 | W2 | P0 | — | FR-05, D-009@v2 | 抽 flush-only 预建 helper（add+flush 不 commit）；本体=helper+commit；既有 trigger 端点调用方零回归（Grill UB-1） |
| task-05 | execution 三态分流+直通 prompt 变体 | W2 | P0 | task-02 | FR-04, D-007@v1 | dispatch_worker worktree 块前探测：git→照旧；direct→跳过 worktree/root_path=工作区根/worktree_branch 保持 None/lease 不写 branch/prompt 直通约束变体（render_worker_prompt 增 mode；**除 worktree 协作约束块外连带调整结果落盘段（execution.py:141-144）的 commit 指令**——产物收集按 run_id 查 AgentArtifact，不依赖 worktree_branch）；unknown→现状（不降级直通） |
| task-06 | mission_context helper（新文件） | W2 | P0 | task-01 | FR-01, D-013@v1 | 首主控轮判定（活跃 mission ∧ prompt 非空 ∧ 无已消耗 orchestrator run——已消耗=status∈{pending,running,completed}，failed 不烧断）+ 简报组装（inject/create 共用） |
| task-07 | SessionCreateRequest.team_mission DTO+校验共享 | W2 | P0 | — | FR-05, FR-06 | daemon/schema.py `TeamMissionCreateBlock`（含 orchestrator_workspace_id）+ SessionCreateRequest 扩展；trigger 端点校验逻辑抽共享函数（daemon/router.py） |
| task-08 | service.py inject 路径简报前缀 | W3 | P0 | task-06 | FR-01, D-004@v1 | `_inject_into_session` 判定命中→SESSION_INJECT prompt=简报+---+用户消息（:1953 组装）；AgentRunLog(user_input) 保持干净；空 prompt 切换轮不注入 |
| task-09 | service.py create 路径预建+E2 解析 | W4 | P0 | task-04,07,08 | FR-05, FR-06, D-009@v2, D-010@v1, D-014@v1 | create 携 team_mission：flush-only helper（首 run 前）+objective=block.objective‖首句+首 run 双标记+首 prompt 简报前缀（:919 组装点，变更前导在前）；E2：orchestrator_workspace_id∈scope 校验+session.workspace_id=W+(W,创建者) binding 钉定（缺失 422）+cwd+默认智能体（显式优先） |
| task-10 | POST /workspaces/probe 端点 | W3 | P1 | task-01,02 | FR-03, D-008@v2 | 批量 {workspace_ids}→[{workspace_id,git_mode,daemon_name,daemon_online}]；复用 collect_scope_workspace_statuses（任一成员 binding 口径）+probe helper；权限 WORKSPACE_WRITE |
| task-11 | daemon mission_status 工具 | W3 | P0 | task-03 | FR-02 | mcp-server.ts 注册第 6 工具（参数可选+X-Session-Id 定位）+hub-client.ts getMissionStatus；能力说明书描述（含 active=false 提示） |
| task-12 | 前端弹层探测+主 agent 选择器 | W4 | P1 | task-07,10 | FR-03, FR-06 | team-trigger-popover.tsx：probe 打开时一次（机器名+在线 dot+git 模式标签，未绑显示「未绑机器」）+主 agent 选择器（仅 preSession 实例渲染，选项=当前会话+scope 工作区带机器状态，离线/未绑禁选） |
| task-13 | 前端预会话解禁+create 携带 | W5 | P0 | task-09,12 | FR-05, FR-06 | session-panel.tsx 预会话 TeamTriggerRow 解禁（门控=引擎+机器在线）+payload 暂存+handlePreSessionSend 携 team_mission+preSession 实例传参；daemon.ts createSession 扩展+probeWorkspaces client |
| task-14 | 测试收尾+类型同步+文档 | W6 | P0 | task-01~13 全部 | FR-07 | 补齐用例清单（三态探测/一次性判定含空 prompt 与 failed 重注/create 回滚无孤儿/E2 binding 422/懒建零回归/patrol 零回归）+简报 token 量化（scope=5 工作区 ≤1.5k）+local.yaml commands.test 全绿+lint 绿+pnpm gen:types（api-types+openapi+daemon api-types）+模块文档更新 |

## 关键路径

task-01 → task-06 → task-08 → task-09 → task-13 → task-14（渲染基础→判定→inject→create→前端接线→收尾，最长链路；6 Wave）

## 同文件并行约束（Wave 内零共享文件）

W1: orchestrator.py / delegate.py；W2: mcp_tools+agent-schema / orchestrator / execution / 新文件 / daemon-schema+router；W3: session-service / workspace-router / daemon-mcp；W4: session-service / popover；W5: panel+daemon.ts；W6: tests+类型+文档——各 Wave 内无同文件 task。

## 全局验收标准

1. 所有单元测试通过（backend pytest -n auto / frontend vitest / daemon vitest，local.yaml commands.test）
2. 集成冒烟（module 策略下按 git diff 命中模块）：create_session 携 team_mission → mission 行+首 run 双标记+首 prompt 含简报前缀+user_input 干净，一例端到端；直通 dispatch 一例（worktree_branch=None，converge 跳过合并）
3. brownfield：无 mission 会话/懒建/patrol/旧 trigger 端点行为不变（既有测试全绿）
4. gen:types 产物同步提交（CLAUDE.md 规则 21）

> 逐项核验结果由 verify 阶段写入 verify-result.md；task 级验收对照 TaskCard frontmatter acceptance。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01~13（全量） | 五层方案落地=各 task 验收 |
| D-002@v1 | task-06, task-08 | 一次性判定单测（重注入不发生） |
| D-003@v1 | —（零改动验证） | 懒建路径既有测试不回归 |
| D-004@v1 | task-01, task-08/09 | prompt 前缀组装断言+user_input 干净断言 |
| D-005@v1 | task-03, task-11 | active=false 200 单测+工具描述 |
| D-006@v2 | task-02, task-05, task-10 | 三态单测（mock delegate 异常/真答） |
| D-007@v1 | task-05 | direct worker worktree_branch=None+finalizer 跳过断言 |
| D-008@v2 | task-10, task-12 | probe 端点单测+弹层渲染测试 |
| D-009@v2 | task-04, task-09 | flush-only 回滚单测（create 中途异常无孤儿）+objective 直取断言 |
| D-010@v1 | task-07, task-09, task-12/13 | E2 create 解析单测+选择器渲染测试 |
| D-011@v1 | —（非目标） | proposal 非目标清单 |
| D-012@v1 | task-03 | 不走 _resolve_session_mission（无 404）单测 |
| D-013@v1 | task-06, task-08 | 空 prompt 不消耗+failed 重注单测 |
| D-014@v1 | task-09 | (W,创建者) binding 缺失 422 单测 |
