# 符号影响面报告

> tasks.md 内容指纹（生成时）: ef1fa572970298bc——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 扫描方式：grep 调用点（DaemonBorrowAudit 构造点 / DaemonMachineListResponse 消费 / useDaemonMachines 消费 / resolve_shared_daemon_for_borrow 调用）+ 任务卡 allowed_paths 对照，2026-08-28 execute step2 实测。

- task-01: 新增 DaemonRuntimeGrant 表模型与 Alembic 迁移（新符号，无既有签名变更）；DaemonBorrowAudit 加 grant_id 可空列——ORM 构造点仅 tests（agent/tests/test_borrow_run_output.py:195、test_daemon_borrow_audit_model.py:187，均在 task-06 related_tests/allowed_paths），生产写入走 placement.py insert 语句（task-03 范围内加列），可空默认不破坏既有构造。无签名级变更（新增类/列）。
- task-02: 新增 grants/queries.py 三查询函数（新符号）；无既有签名变更。
- task-03: session/service.py create_session 内部校验替换（:932-937 owner-only → authorize_pinned_runtime，函数签名不变）；placement._query_pinned_online_runtime 内部授权分支（签名不变）；注意 daemon.md 卡片记录 dispatch_worker 直连 prepare_interactive_dispatch 绕过 create_session（team-subsession-governance），该路径不受本改动影响（placement 复查分支同步扩展覆盖）。无签名级变更（内部逻辑替换）。
- task-04: 新增 grants/{schema,service,router}.py（新符号；挂载在 task-07）。无既有签名变更。
- task-05: create_session 内部分支（签名不变）；execution.py 新增 shared 场景 tool_config 构造 helper（新函数，与 worker_tool_config 并列，不改其签名）。无签名级变更。
- task-06: borrow_resolver 内部数据源切换（签名不变）；queries.resolve_shared_daemon_for_borrow 保留原签名做薄壳（调用点 placement.py:23 import，运行时依赖、文件不重叠、W3 可并行）；member_runtimes service/router 内部实现改。无签名级变更。
- task-07: daemon/schema.py DaemonMachineListResponse / DaemonRuntimeListResponse 响应 DTO 新增 shared_to_me 字段（带默认空列表 → OpenAPI 非必填，api-types 生成 optional，既有 typed mock 不破坏）；runtime/service.list_machines/list_runtimes_page 返回结构附加块（函数签名不变）。后端消费点 router.py:741-759（本 task 范围）；前端消费 use-daemon-machines.ts → runtimes/page.tsx、sessions/page、session-config-bar.tsx、**移动端 m/workspaces/[id]/sessions 两页 + 4 个测试文件**（grep 实测，超出 task-10 清单）——hook 层新增字段对移动端零改动传播（可选字段），移动端渲染共享机器属自然获得行为（FR-05 后端授权放行，无破坏）；若移动端测试因 mock 断言失败，按 related_tests 债处理（默认不失败：字段 optional）。DTO 字段级变更，消费点均登记。
- task-08: api-types.ts 重生成（生成物，openapi-typescript 产物非手写签名）。无签名级变更。
- task-09: 新组件 + page.tsx/daemon.ts 内部改动（无导出签名变更）。无签名级变更。
- task-10: use-daemon-machines hook 返回结构随 api-types 扩展（新增字段不改既有字段类型，调用方零改动）；floating-host/session-config-bar/session-panel 内部渲染改动。无签名级变更。
- task-11: 验证型任务，无代码变更，无签名级变更。
