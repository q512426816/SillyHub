---
id: task-02
title: extend-file-can-access-with-agent-session-and-run-ownership
title_zh: 'backend file/service._can_access 扩 agent_session/agent_run 归属（D-004@v2 解析链 + NULL deny）+ 单测'
author: 'qinyi'
created_at: 2026-08-23 09:37:06
priority: P0
depends_on: [task-01]
blocks: [task-03]
requirement_ids: [FR-04]
decision_ids: [D-004@v2]
provides:
  - contract: workspace-anchor-resolve-chain
    fields: [session-anchor, run-resolve-chain, null-deny]
expects_from:
  task-01:
    - contract: file-dto-extended
      needs: [description]
allowed_paths:
  - backend/app/modules/file/service.py
  - backend/app/modules/file/tests/test_file_agent_owner.py
goal: >
  让 agent 上传文件的下载权限跟随会话/run 所属 workspace（能访问所属 workspace 即可下载，FR-04 / D-004@v2）——
  _can_access 新增 agent_session/agent_run 两归属分支；AgentRun 无 workspace_id 列，按
  target_workspace_id、mission.workspace_id、task.workspace_id 三段解析链取锚，锚 NULL 或链全空一律兜底 deny。
implementation:
  - _can_access 在 workspace 分支后追加 agent_session 分支——owner_id 非空时主键单查 AgentSession 取 workspace_id，NULL 兜底 deny（无权与不存在同语义 404）
  - 追加 agent_run 分支——解析链依次取 run.target_workspace_id，为空则 run.mission_id 查 AgentMission.workspace_id，再为空则 run.task_id 查 tasks 表 workspace_id，三段全空的孤儿 run 兜底 deny
  - 两分支命中锚后统一复用既有 has_permission(WORKSPACE_READ) 判定（权限解析收敛 auth/rbac.py，不在 file 模块重复实现）；逐行主键/外键单查（R-06 量级与会话文件数同阶可接受）
  - 新建 test_file_agent_owner.py——覆盖会话归属成员可见/非成员 404、AgentSession.workspace_id 为 NULL deny、run 解析链三段各自命中、链全空孤儿 deny、uploaded_by 本人与 platform_admin 豁免不回归
acceptance:
  - 有 WORKSPACE_READ 的用户可访问 agent_session/agent_run 归属文件（get_meta/get_stream/batch_meta 可见性一致），无权用户统一 404
  - AgentRun 锚点解析顺序为 target_workspace_id 优先、其次 mission.workspace_id、再次 task.workspace_id；三处全空 deny
  - AgentSession.workspace_id 为 NULL 时 deny；既有 owner_type=workspace 分支与本人/admin 豁免行为不变
  - file 模块既有测试零回归
verify:
  - cd backend && uv run pytest app/modules/file -q
constraints:
  - _can_access 只增不改既有分支（design §9）；不新增端点、不改 router（GET /api/agent/file-artifacts 的锚定复核属 task-03 复用本解析链）
  - 与 task-01 共享 service.py 故错波执行（plan Wave 2）；owner_type 为自由字符串无迁移改动；不做缓存或批量预取优化（R-06 单查可接受）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
