---
id: task-06
title: 'notify-session-owner-on-daemon-permission-request-and-timeout'
title_zh: '触发点③ daemon 权限请求/超时 owner 定向通知（owner=AgentSession.user_id，自响应豁免）'
author: 'qinyi'
created_at: 2026-08-29 21:04:42
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-008@v1, D-010@v1, D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/permission_service.py
  - backend/app/modules/daemon/tests/
expects_from:
  - task_id: task-02
    contract: NotificationService.notify_user
    needs: [recipient_user_id, type, ref_type, ref_id]
goal: >
  在 daemon/permission_service.py 挂触发点③——handle_permission_request（292）在既有 _publish_session_event
  成功后向会话 owner（AgentSession.user_id，D-010@v1）定向发 permission_request 通知（canUseTool 与
  AskUserQuestion dialog 两种 kind 都覆盖）；_on_timeout（1145）超时失效时重查会话取 owner 发
  permission_timeout；owner 自响应（respond/_respond_dialog）不通知（D-008@v1）。
implementation:
  - handle_permission_request 在 _publish_session_event（420）成功后，取 AgentSession.user_id 作为 owner，notify_user 发 permission_request；ref_type 按 kind 取 session_permission 或 session_dialog，ref_id 用 session_id；HTTP 上行通道（552）已委托 WS 方法，单点挂钩即覆盖双通道
  - canUseTool 与 AskUserQuestion dialog 两种 kind 分别组织 title/body 文案，都覆盖
  - _on_timeout（1145）只收请求 id，需用新开短 session 重查会话取 owner（不依赖调用方事务），notify_user 发 permission_timeout；不消解历史 permission_request 通知（v1 取舍 R-09）
  - respond_permission（858）与 _respond_dialog 不加通知（owner 自操作豁免，D-008@v1）
  - 通知整体 best-effort try/except 包裹，异常仅 log.warning，不影响权限请求登记与超时回调既有行为（D-001@v1 旁路原则）
  - 在 daemon/tests 补用例，覆盖两种 kind 的请求通知、超时通知、自响应不通知、通知异常不影响主流程；跑既有 session_permissions/permission_http_uplink 相关测试回归
acceptance:
  - WS 与 HTTP 上行两通道的权限请求均使会话 owner 收到 permission_request 通知，ref_type/ref_id 正确
  - 权限请求超时失效时 owner 收到 permission_timeout 通知（owner 以重查的 AgentSession.user_id 为准）
  - owner 自己 respond 或 _respond_dialog 时不产生任何通知
verify:
  - cd backend && python -m pytest app/modules/daemon/tests -q
constraints:
  - owner 口径固定为 AgentSession.user_id，不得改用 runtime owner（D-010@v1，runtime owner ≠ creator 是明文支持场景）
  - 不修改 handle_permission_request/_on_timeout/respond 的既有签名与生命周期契约，通知只在既有事件点旁路
  - _on_timeout 内新开短 session，不复用调用方事务
related_tests:
  - backend/app/modules/daemon/tests/test_session_permissions.py
  - backend/app/modules/daemon/tests/test_permission_http_uplink.py
  - backend/app/modules/daemon/tests/test_ws_hub_permission.py
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
