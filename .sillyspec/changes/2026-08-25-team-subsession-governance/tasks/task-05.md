---
id: task-05
title: 'dispatch_worker 换子会话三元组派发（保留 scope/越权/治理门/在线预检/AgentRunWorkspace）'
title_zh: 'dispatch_worker 换子会话三元组派发（保留 scope/越权/治理门/在线预检/AgentRunWorkspace）'
author: 'qinyi'
created_at: 2026-08-25 20:57:40
priority: P0
depends_on: ['task-02', 'task-03', 'task-04']
blocks: []
requirement_ids: [FR-02, FR-09]
decision_ids: [D-001@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/agent/mcp_tools.py
  - backend/app/modules/agent/tests/test_worker_subsession_dispatch.py
provides:
  - contract: mission_worker_sessions 分身行数据源
    fields: [sub_session_id, first_run_id, role, objective, status]
expects_from:
  - 'task-02 execution.py 抽出的共享 worktree helper（git 模式探测 + direct 旁路 + git_worktree_add 三段同源，产出 root_path 与 worktree_branch）——分身派发直接复用，本卡不重写 worktree 逻辑'
  - 'task-03 placement.prepare_interactive_dispatch 增 stage 参数写 lease metadata.stage（MISSION_WORKER_STAGE 常量）+ 代表 binding 钉定模式（resolve_representative_binding 解析 runtime 直接钉定但跳属主校验，anchor 本机自有 runtime 优先）'
  - 'task-04 session/service.py create_session 三元组模式参数化入口（parent_session_id / owner=mission.created_by / stage / 首 run 双标记 mission_id+role，同事务原子提交）+ mission_context 分身任务简报渲染（objective + worktree 约束 + worker_done 用法）'
goal: >
  mcp_tools._dispatch_worker_core 执行段从「建 batch AgentRun + placement.dispatch_to_daemon
  批量 lease」整体切换为子会话三元组派发——AgentSession(parent_session_id=主控会话,
  user_id=mission.created_by) + interactive lease(metadata.stage=mission_worker) + 首 run
  (mission_id+role 双标记) 同事务提交；前置治理段（scope 校验、BE-P0-2 越权、治理门、
  在线预检、AgentRunWorkspace 关联行）逐项保留，分身以可流式可追问的子会话形态运行
  （FR-02 / design §5.B）。
implementation:
  - '保留段不动——scope 校验（target_workspace_id ∈ anchor∪scope 越界 400）、BE-P0-2 跨 ws 越权复核（Bearer 对 target 复核 WORKSPACE_WRITE）、_resolve_dispatch_agent_profile 档案校验、治理门 can_dispatch_worker（W3 后为 task-11 混跑口径）、resolve_representative_binding 在线预检（全无在线 422 不建会话）、AgentRunWorkspace 关联行（anchor+target 双关联）'
  - '执行段替换——不再建 batch AgentRun、不再调 MissionExecutionService.dispatch_worker 与 placement.dispatch_to_daemon；改走 task-04 参数化入口建三元组——AgentSession(parent_session_id=主控会话, user_id=mission.created_by, workspace_id=effective_target) + kind=interactive lease(metadata.stage=MISSION_WORKER_STAGE, metadata.role=role) + 首 run(mission_id=mission.id, role=role, objective, agent_session_id=子会话)，单事务 commit 无孤儿'
  - 'worktree——调 task-02 共享 helper 三形态定 root_path（git 建 .worktrees/<首 run 短8> 副本 + worktree_branch 落首 run；direct 旁路 worktree_branch 保持 None；caller 路径A worktree_path 直接作子会话 cwd），副本路径进 lease metadata'
  - '首 prompt 用 task-04 分身任务简报（objective + worktree 约束 + worker_done 用法）；payload.worker_prompt 显式覆写优先；跨 ws target 经 task-03 代表钉定模式落代表机器'
  - '失败语义——worktree/派发失败复用 mark_worker_run_failed 同款收敛（首 run failed + error_code + finished_at，子会话收口终态），不崩 mission 主 agent 可补派；返回 WorkerRunResponse 用首 run 组装（id=首 run id、lease_id=interactive lease），字段契约不变'
  - '新增 test_worker_subsession_dispatch.py——三元组落库断言（parent/owner/stage/双标记/AgentRunWorkspace）、各拒绝路径不建会话、worktree 失败标 failed、显式路由族（ws+mid / 仅 mid）与 header 会话族同构零回归'
acceptance:
  - '派发成功后 DB 三元组齐——子会话 parent_session_id=主控会话、user_id=mission.created_by、lease kind=interactive 且 metadata.stage=mission_worker、首 run 带 mission_id+role 双标记、AgentRunWorkspace 关联行在'
  - '拒绝路径行为不变——scope 越界 400 / 跨 ws 无权限 403 / 治理门拒绝 400 / 无在线绑定 422，且均不建子会话不建 run'
  - 'worktree 失败——分身首 run failed(worktree_create_failed) + finished_at + error_code，子会话不残留活跃态，mission 不崩可继续派发'
  - '跨 ws target 派发经代表钉定落在目标工作区代表机器（anchor 自有 runtime 在线时优先）'
  - 'WorkerRunResponse 字段契约不变（daemon mcp-server 消费方零改动）'
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_worker_subsession_dispatch.py -q --no-cov
  - cd backend && uv run pytest app/modules/agent -q --no-cov -n auto
  - cd backend && uv run ruff check app/modules/agent/mcp_tools.py && uv run mypy app/modules/agent/mcp_tools.py
constraints:
  - '只改 mcp_tools.py——execution.py 的 worktree 复用已由 task-02 抽好，本卡不改 execution.py / placement.py / session/service.py / mission_context.py（契约在 task-02/03/04）'
  - '不动 list_workers / _converge_core / _mission_status_core 的判据与数据源（task-09/13 域）；不动 _resolve_session_mission 解析与懒建链路'
  - '存量 batch 分身 mission 双判据零回归——本卡只改新派发形态，存量 run 的判据回落不经此卡（FR-09）；全部现有 dispatch 测试（caller_worktree / direct_mode / worktree / profile / metadata）不改断言全绿'
  - '递归闸不经本卡——分身受限工具注入属 daemon 侧（task-06），backend 派发不向分身提供任何派发工具'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
