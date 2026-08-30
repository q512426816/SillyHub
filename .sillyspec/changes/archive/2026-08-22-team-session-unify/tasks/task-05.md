---
id: task-05
title: 'mcp-tools X-Session-Id resolution + dispatch-worker lazy-create'
title_zh: 'mcp_tools 会话定位——X-Session-Id 解析 + dispatch_worker 懒建（补回填双标记/并发守卫/无工作区 422/默认预算上限）'
author: 'qinyi'
created_at: 2026-08-22 03:35:53
priority: P0
depends_on: [task-02, task-03, task-04]
blocks: [task-06, task-14]
requirement_ids: [FR-03, FR-04]
decision_ids: [D-004@v1, D-009@v1]
allowed_paths:
  - backend/app/modules/agent/mcp_tools.py
  - backend/app/modules/agent/tests/test_mcp_tools.py
expects_from:
  task-02: [{contract: get_active_mission_for_session, needs: [session_id]}]
  task-03: [{contract: TeamMissionSummary, needs: [mission_id, scope_workspace_ids]}]
  task-04: [{contract: ORCHESTRATOR_RUN_TAGGING, needs: [run.mission_id, run.role]}]
provides:
  - contract: SESSION_SCOPED_MISSION_RESOLUTION
    fields: [X-Session-Id 解析活跃 mission, 懒建含默认预算与并发守卫]
goal: >
  5 个团队 MCP 端点按 X-Session-Id 解析会话活跃 mission，dispatch_worker 无活跃 mission 时懒建兜底——补回填双标记/并发守卫/无工作区 422/默认预算上限（design §5 Phase 1 懒建段、§7）。
implementation:
  - 新增 X-Session-Id 解析辅助（按会话查活跃 mission），5 个 MCP 端点统一接入；缺省 mission_id/workspace_id 可解析，显式参数仅作越权校验锚，并为缺参调用提供会话维度路由形态（既有 workspace/mission 路径前缀路由零回归）
  - dispatch_worker 懒建——无活跃 mission 且会话绑定 workspace 时 scope=该工作区（objective 用 dispatch 上下文，预算取 daemon 配置默认上限防 R-02），复用 task-03 创建入口与 scope 冻结快照读取
  - 会话未绑定 workspace → 422 提示走派团队弹层显式选择范围（CC-10）
  - 并发守卫——懒建前对会话行 SELECT FOR UPDATE + uq_agent_missions_session_active 部分唯一索引兜底，唯一冲突重查复用活跃 mission，同 turn 并发 dispatch 不双建（Grill NEW-3）
  - 懒建成功后按 X-Session-Id 补回填会话当前活跃 run 的 mission_id+role='orchestrator' 双标记（与 task-04 inject 同语义，Grill NEW-1）
  - 懒建/422/并发守卫/预算上限新用例补进 test_mcp_tools.py
acceptance:
  - 无活跃 mission 且会话有工作区时 dispatch_worker 懒建并补回填当前活跃 run 双标记
  - 会话无工作区返回 422 及引导弹层文案
  - 同会话并发 dispatch 不产生双 mission（FOR UPDATE+部分唯一索引）
  - 工具参数 mission_id/workspace_id 缺省可经 X-Session-Id 解析，显式参数仅作越权校验锚
  - 懒建默认预算上限（daemon 配置）生效
verify:
  - cd backend && uv run pytest app/modules/agent -q --no-cov --deselect app/modules/agent/tests/test_dispatch_metadata.py::test_build_claim_payload_propagates_bundle_fields --deselect app/modules/agent/tests/test_execution_context.py::test_get_execution_context_task_run
constraints:
  - daemon 侧 X-Session-Id 发送与工具参数可选化归 task-10；converge 内部语义归 task-06（同文件分 Wave W3/W4 防并行冲突）
  - 懒建不建主控 AgentRun/lease——主控=会话当轮 run 双标记（D-009）
  - 存量 external mission 既有路径与行为零回归（team-progress 在用）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
