---
id: task-04
title: 'backend tests — sillyspec platform commands (permissions / whitelist / 504 / two-state persistence / machines view)'
title_zh: 'backend 测试（端点权限/白名单/504/两态落库/键不出现置 NULL/register 恒清）'
author: 'qinyi'
created_at: 2026-09-04 22:40:15
priority: P0
depends_on: ['task-02', 'task-03']
blocks: []
requirement_ids: [FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-003@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/daemon/tests/test_sillyspec_platform_commands.py
  - backend/app/modules/daemon/protocol.py
  - backend/app/modules/daemon/ws_hub.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/runtime/service.py
  - backend/app/modules/daemon/model.py
goal: >
  为 task-02 两端点与 task-03 心跳结果链路补齐 backend 测试——端点权限三态、change 白名单、
  离线 504、sillyspec_command_result 两态落库与 register 恒清、GET /machines 透出，
  全部锚定 design §5/§7 契约与 D-004@v1 两态语义。
implementation:
  - 新建 test_sillyspec_platform_commands.py——fixture 与命名照 test_machine_sillyspec.py 惯例（root conftest 的 db_session/client、_seed_user 手签 JWT、fresh_ws_hub 替换进程级单例、_create_machine 直插行、_reload_instance expire 直读库），ws_hub mock 范式照 test_machines_router.py 既有 self-update 用例
  - 权限用例——owner（本机所有者）与平台 admin 各 200 sent true；持 RUNTIME_ADMIN 但非 owner 非平台 admin → 404（code HTTP_404_DAEMON_RUNTIME_NOT_FOUND，防存在性泄漏）；无权限普通用户 → 403；resolve 与 ghost-cleanup 两端点各覆盖
  - 白名单与 504——合法 change 与 keep_local/take_platform 两 strategy 200；含 .. 穿越形态、非法首字符、超长（>127 字符）change 与非法 strategy → 422 且 mock 的 ws_hub 零调用；send_* 返回 False → 504 且 details 含 daemon_instance_id
  - 心跳两态（RuntimeService 直调 + HTTP 全链路双覆盖）——携带对象 → daemon_instances.sillyspec_command_result 整包直写（七键 action/change/strategy/state/exit_code/error/executed_at 原样、无 since 注入）；键不出现（缺省与显式 null 同置 NULL，pydantic 不可区分）；register 恒清（心跳落库后 register → NULL）
  - 透出与 OpenAPI——GET /machines items[] 的 sillyspec_command_result 为 MachineSillySpecCommandResultRead 嵌套类型化七键形态、NULL 机为 null；app.openapi() 断言两新端点路径与 schema 引用（task-08 gen:types 输入可再生产）
acceptance:
  - 权限矩阵全绿——owner 200 / 平台 admin 200 / 越权 404（code HTTP_404_DAEMON_RUNTIME_NOT_FOUND）/ 无权限 403，两端点各覆盖
  - 白名单与离线全绿——非法 change（含 ../非法首字符/超长）与非法 strategy → 422 且不触达 ws_hub；合法请求 200 sent true；send 失败 → 504 + details 含 daemon_instance_id
  - 两态落库全绿——对象整包直写七键 / 键不出现置 NULL / register 恒清，服务层与 HTTP 层双覆盖
  - GET /machines 透出嵌套类型化七键形态 + OpenAPI 含两新端点路径与 sillyspec_command_result 引用
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_sillyspec_platform_commands.py -q --no-cov
  - cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto（daemon 模块级回归，非全量）
constraints:
  - 测试为主——仅当测试暴露被测源缺陷时可修 allowed_paths 内源文件，回 design §5/§7 对照修正，禁止弱化断言迁就实现
  - 心跳 DTO 全字段宽松可选照 DaemonHeartbeatSillySpecStatus 先例；error 截断 ≤200 归 daemon 侧（task-07 锚定），本卡不测
  - 仅跑本文件 + daemon 模块回归，不跑 backend 全量（CLAUDE.md 规则 0）
expects_from:
  - 'task-02 两端点契约——路径/请求模型（change+strategy）/权限与白名单与 504 行为/响应 sent true'
  - 'task-03 心跳 DaemonHeartbeatSillySpecCommandResult DTO 两态落库语义 + MachineSillySpecCommandResultRead 透出形态'
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
