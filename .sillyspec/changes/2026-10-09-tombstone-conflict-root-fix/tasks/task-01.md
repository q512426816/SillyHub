---
id: task-01
title: 'backend tombstone_cleanup 指令通道（端点+WS+action 枚举+openapi/api-types 重生成）'
title_zh: 'backend tombstone_cleanup 指令通道（端点+WS+action 枚举+openapi/api-types 重生成）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-09 11:58:09
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04]
requirement_ids: [FR-03]
decision_ids: [D-001@v1, D-002@v1]
provides: 'WS 消息 daemon:sillyspec_tombstone_cleanup（payload: change, workspace_id）+ POST /machines/{id}/sillyspec-tombstone-cleanup 端点 + action 枚举 tombstone_cleanup'
allowed_paths:
  - backend/app/modules/daemon/router/machines.py
  - backend/app/modules/daemon/ws_hub.py
  - backend/app/modules/daemon/model.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router/heartbeat.py
  - backend/openapi.json
  - backend/app/modules/daemon/tests/test_machine_tombstone_cleanup.py
target_files:
  - backend/app/modules/daemon/router/machines.py
  - backend/app/modules/daemon/ws_hub.py
  - backend/app/modules/daemon/model.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router/heartbeat.py
  - backend/openapi.json
  - backend/app/modules/daemon/tests/test_sillyspec_platform_commands.py
goal: >
  建立 backend→daemon 的 tombstone_cleanup 指令通道（FR-03 前置）：新端点+WS 发送+回执 action 枚举扩展，
  为 task-02（删除环下发）/task-03（daemon 执行器）/task-04（前端按钮）提供契约。复用 sillyspec-ghost-cleanup
  先例形态（backend/app/modules/daemon/router/machines.py:308 fire-and-forget+离线 504）。
implementation:
  - backend/app/modules/daemon/schema.py 加请求体 MachineSillySpecTombstoneCleanupRequest{workspace_id=UUID, change=str}（对齐 MachineSillySpecResolveRequest 形态，参照 2026-09-09-conflict-root-workspace-scoping task-04 的 workspace_id 必填语义）
  - backend/app/modules/daemon/router/machines.py 新增 POST /machines/{instance_id}/sillyspec-tombstone-cleanup：RuntimeAdminUser + _get_owned_instance 归属校验 + ensure_workspace_member 成员校验（复用 resolve 端点 296-302 行同款）+ ws_hub 发送 + 离线 504 DaemonRuntimeOffline
  - backend/app/modules/daemon/ws_hub.py 加 send_sillyspec_tombstone_cleanup(instance_id, change, workspace_id)（对齐 send_sillyspec_resolve:428 形态，消息 type=daemon:sillyspec_tombstone_cleanup）
  - backend/app/modules/daemon/model.py MachineSillySpecCommandResultRead 的 action 联合类型加 'tombstone_cleanup'（155 行注释同步）
  - backend/app/modules/daemon/router/heartbeat.py sillyspec_command_result 落槽对 action='tombstone_cleanup' 纯透传（不新增关闭逻辑——收敛闭环走既有全绿关闭路径，design Phase 2 第 5 步钉死）
  - 重生成 openapi（backend 侧）供 daemon/frontend 后续 gen:types
  - 新增 backend/app/modules/daemon/tests/test_machine_tombstone_cleanup.py：权限（非 owner 普通用户 403/404、owner 与平台管理员放行）、离线 504、payload 透传（change+workspace_id）、action 枚举含 tombstone_cleanup
acceptance:
  - POST /machines/{id}/sillyspec-tombstone-cleanup 对 owner/平台管理员返回 {"sent": true} 且 WS 消息携带 change+workspace_id（测试断言）
  - 机器离线/WS 发送失败返回 504（details 含 daemon_instance_id），文案与 sillyspec-ghost-cleanup 同款
  - 非成员/越权请求被 ensure_workspace_member 拒绝
  - openapi.json 含新端点定义；action 联合类型含 tombstone_cleanup
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_machine_tombstone_cleanup.py -q --no-cov
constraints:
  - fire-and-forget 无回执不落库（同 SILLYSPEC_UPDATE 语义，不排队）
  - 不新增任何注册表关闭逻辑（design Phase 2 第 5 步：两个不选理由——结果槽无 workspace_id；聚合单行过早关闭）
  - 错误文案一律中文；不引入新依赖
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
