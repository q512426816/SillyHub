---
id: task-02
title: 'backend REST endpoints for sillyspec resolve and ghost cleanup (ownership + change whitelist + offline 504)'
title_zh: 'backend REST 端点（sillyspec-resolve / sillyspec-ghost-cleanup：权限+归属+change 白名单+504）'
author: 'qinyi'
created_at: 2026-09-04 22:40:15
priority: P0
depends_on: [task-01, task-03]
blocks: []
requirement_ids: [FR-02, FR-03, FR-04]
decision_ids: [D-001@v1, D-003@v1]
provides: >
  两个管理端点供 task-08 前端触发函数消费。POST /daemon/machines/<instance_id>/sillyspec-resolve，body 含 change 与 strategy（Literal keep_local 或 take_platform）；
  POST /daemon/machines/<instance_id>/sillyspec-ghost-cleanup 无 body；两端点 200 返回 sent true，离线或发送失败 504 DaemonRuntimeOffline，change 白名单不过 422。
expects_from:
  - task-01 ws_hub 的 send_sillyspec_resolve(instance_id, change, strategy) 与 send_sillyspec_ghost_cleanup(instance_id)
  - task-03 心跳 DTO DaemonHeartbeatSillySpecCommandResult（定义归 task-03，本卡仅共享 router.py 机器视图组装语境）
allowed_paths:
  - backend/app/modules/daemon/router.py
goal: >
  照 trigger_machine_sillyspec_update 先例（router.py:1268-1302）新增两个管理端点，
  把冲突裁决与 ghost 清理指令经 WS 直发目标机器，为操作台提供下发入口。
implementation:
  - router.py 加请求模型，change 走白名单 ^[A-Za-z0-9][A-Za-z0-9._-]*$（长度 1-128 且显式拒绝含 ..），strategy 用 Literal keep_local 或 take_platform
  - 新增 trigger_machine_sillyspec_resolve 端点，RuntimeAdminUser 权限 + _get_owned_instance 归属校验（越权或不存在 404），调 hub.send_sillyspec_resolve
  - 新增 trigger_machine_sillyspec_ghost_cleanup 端点，同款权限与归属链，无请求 body，调 hub.send_sillyspec_ghost_cleanup
  - 两端点 sent 为 False 时抛 DaemonRuntimeOffline（504，文案与 details 同 sillyspec-update 先例），成功返回 sent true
acceptance:
  - sillyspec-resolve 正常请求返回 200 且 sent true；strategy 非法或 change 含非法字符、含 ..、超长返回 422
  - sillyspec-ghost-cleanup 无 body 返回 200 且 sent true
  - 普通用户访问非本人机器返回 404，owner 与平台管理员放行（D-003@v1）
  - 机器离线或发送失败返回 504 DaemonRuntimeOffline，details 含 daemon_instance_id
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto
  - cd backend && uv run ruff check app/modules/daemon && uv run ruff format --check app/modules/daemon
constraints:
  - 端点行为测试归 task-04（test_sillyspec_platform_commands.py），本卡不新增测试
  - 不改 protocol.py 与 ws_hub.py（task-01 范围），不定义心跳 DTO 与机器视图字段（task-03 范围），仅消费；共享 router.py 故串行 Wave 执行，编辑前先拉最新文件
  - 保持 fire-and-forget 无回执无排队语义（D-001@v1），不动 sillyspec-update 既有端点
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
