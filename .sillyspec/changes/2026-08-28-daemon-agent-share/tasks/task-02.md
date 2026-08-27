---
id: task-02
title: implement-grants-authorization-queries
title_zh: 'grants 授权查询——`authorize_pinned_runtime` / `list_machines_shared_to_me` / `resolve_granted_daemon_for_borrow` + 授权矩阵单测'
author: 'qinyi'
created_at: 2026-08-28 01:24:05
priority: P0
depends_on: ['task-01']
blocks: ['task-03', 'task-06', 'task-07']
requirement_ids: [FR-01, FR-02]
decision_ids: [D-006@v1]
allowed_paths:
  - backend/app/modules/daemon/grants/queries.py
  - backend/app/modules/daemon/grants/tests/test_grants_authorization.py
provides:
  - contract: GrantAuthorization
    fields: [kind, grant_id, lender_user_id, platform_binding]
  - contract: SharedMachineRow
    fields: [machine_id, display_name, lender_display_name, source_workspace_id, online]
  - contract: BorrowResolution
    fields: [runtime, lender_user_id, grant_id]
goal: >
  在 grants/queries.py 实现 design §7 的三条授权查询（钉定授权、共享给我的机器、借用解析），供 task-03/06/07 统一消费 grants 数据源。
implementation:
  - authorize_pinned_runtime——actor 拥有该 runtime 返回 kind=owner；runtime 为某生效 platform grant 的 pinned_runtime 返回 kind=platform_grant 与 platform_binding（agent_profile_id 与 source_workspace_id 与 writable_dir）；否则 actor 是 grantee 工作区成员（user_workspace_roles）且持 Permission.DAEMON_BORROW 且 grant.enabled 且 daemon 在线时返回 kind=workspace_grant；未命中返回 None
  - list_machines_shared_to_me——grants join actor 的 user_workspace_roles 成员资格与 daemon_instances，仅取 enabled 行，输出 machine_id 与 display_name 与 lender_display_name 与 source_workspace_id 与 online
  - resolve_granted_daemon_for_borrow——SQL 语义与原 resolve_shared_daemon_for_borrow（member_runtimes/queries.py:171）逐条等价（enabled 对应 shared=TRUE、daemon_id 非空、granted_by 不等于 actor、同工作区、daemon 在线），provider 非空严格匹配否则取最近心跳在线 runtime，返回 runtime 与 lender_user_id 与 grant_id 三元组
  - 授权矩阵单测——owner、platform_grant、workspace_grant 三类命中与全部未授权分支（非成员、缺 daemon:borrow 权限、enabled=false、daemon 离线、runtime 不存在）、机器列表过滤、借用等价性与 provider 两形态
acceptance:
  - authorize_pinned_runtime 三分支返回结构符合 GrantAuthorization 契约（kind、grant_id、lender_user_id、platform_binding），未授权场景一律返回 None
  - list_machines_shared_to_me 仅返回 actor 所属工作区且 enabled 的共享机器，行含 lender 显示名与在线状态
  - resolve_granted_daemon_for_borrow 对同一组 fixture 与原 shared 版查询结果一致且额外携带 grant_id；授权矩阵单测全部通过
verify:
  - cd backend && uv run pytest app/modules/daemon/grants -q --no-cov -n auto
constraints:
  - 只新增 queries.py 与测试零接线——不改 session 与 placement 与 borrow_resolver 与 member_runtimes 任何调用方（切换归 task-03/06）；provides 三契约字段名钦定，下游按此对接不得增删
  - 借用解析语义等价红线——grants 空表或未授权时返回 None 或空列表，存量 agent-run 借用行为零变化
  - workspace 分支必须同时校验成员资格与 Permission.DAEMON_BORROW（auth/permissions.py），权限不足不得命中
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
