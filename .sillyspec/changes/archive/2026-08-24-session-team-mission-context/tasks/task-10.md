---
id: task-10
title: 'POST /workspaces/probe 端点——批量 git_mode+daemon_name+daemon_online（复用 collect+probe helper，任一成员 binding 口径）'
title_zh: 'POST /workspaces/probe 端点——批量 git_mode+daemon_name+daemon_online（复用 collect+probe helper，任一成员 binding 口径）'
author: 'qinyi'
created_at: 2026-08-24 18:49:24
priority: P0
depends_on: ['task-01', 'task-02']
blocks: [task-12]
requirement_ids: [FR-03]
decision_ids: [D-008@v2]
allowed_paths:
  - backend/app/modules/workspace/router.py
  - backend/app/modules/workspace/schema.py
  - backend/app/modules/workspace/tests/
provides:
  - contract: workspaces_probe_response
    file: backend/app/modules/workspace/router.py
    fields: [workspace_id, git_mode, daemon_name, daemon_online]
    consumers: [task-12]
goal: >
  新增 POST /api/workspaces/probe 批量探测端点——workspace_ids 进、各工作区 git_mode/daemon_name/daemon_online 出，为弹层机器状态提供后端统一口径（任一成员 binding，消除本人/他人 binding 展示不一致，FR-03/D-008@v2）。
expects_from:
  task-01:
    - contract: collect_scope_workspace_statuses
      needs: [collect_scope_workspace_statuses]
  task-02:
    - contract: probe_workspace_git_mode
      needs: [probe_workspace_git_mode]
implementation:
  - workspace/schema.py 新增 WorkspaceProbeRequest（workspace_ids list[UUID] 上限 20 对齐 scope 口径）与响应项 DTO（workspace_id/git_mode/daemon_name/daemon_online）
  - workspace/router.py（prefix=/workspaces）注册 POST /probe，置于 /{workspace_id} 动态段之前，权限 require_permission_any(Permission.WORKSPACE_WRITE) 对齐既有 POST 路由（router.py:89-103 模式）
  - handler 批量取 Workspace 行后复用 task-01 的 collect_scope_workspace_statuses（任一成员 binding 解析机器名 display_alias||hostname+在线态）与 task-02 的 probe_workspace_git_mode 三态探测组装响应
  - 补测试——多工作区批量/未绑机器（daemon_name=None 且 offline）/git 与 direct 态/探测异常归 unknown
acceptance:
  - POST /api/workspaces/probe 请求 workspace_ids 列表 → 200 返回每工作区 workspace_id/git_mode/daemon_name/daemon_online，git_mode ∈ git/direct/unknown
  - 机器解析按任一成员 binding（含他人绑定），与简报/mission_status 同源同口径（D-008@v2）
  - 无 WORKSPACE_WRITE 权限 403；空或超限 workspace_ids 422
  - 探测 RPC 失败或未绑 daemon → git_mode=unknown 不抛 5xx（fail-safe）
verify:
  - cd backend && uv run pytest app/modules/workspace -q --no-cov -n auto
constraints:
  - 只读端点无状态变化（design §7.5）；每次调用实时探测不缓存（R-02）
  - 不改 workspace 模块既有路由行为；前端消费（task-12）与 api-types 同步（task-14）不在本卡
  - N 为 scope 级个位数，不做并发探测优化（YAGNI）
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
