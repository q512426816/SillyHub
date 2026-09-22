---
id: task-08
title: 'backend 受理放宽 + 即时 deny——background_task=true 替换 current_run 校验块（run 直查+agent_session_id 归属）；全部校验失败分支推 _deny_respond（runtime_id ack 键 + PLATFORM_PERMISSION_DROPPED: 前缀，best-effort）'
title_zh: 'backend 受理放宽 + 即时 deny——background_task=true 替换 current_run 校验块（run 直查+agent_session_id 归属）；全部校验失败分支推 _deny_respond（runtime_id ack 键 + PLATFORM_PERMISSION_DROPPED: 前缀，best-effort）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 16:45:00
priority: P0
depends_on: ['task-07']
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/permission_service.py
target_files:
  - backend/app/modules/daemon/permission_service.py
expects_from:
  - task-07 PermissionRequestPayload.background_task
  - task-04 daemon 侧 payload 字段名 background_task（snake_case）
related_tests:
  - backend/app/modules/daemon/tests/test_session_permissions.py
  - backend/app/modules/daemon/tests/test_ws_hub_permission.py
  - backend/app/modules/daemon/tests/test_permission_http_uplink.py
goal: >
  放宽 background_task=true 权限请求的受理校验（直查 run + agent_session_id 归属，
  不再要求 active turn），并在所有校验失败 return False 前 best-effort 推即时 deny，
  消除后台任务权限请求被静默丢弃导致的锁死。
implementation:
  - "新增私有方法 _deny_respond(daemon_id, payload, reason)：经
    ws_hub.send_permission_response best-effort 推 PERMISSION_RESPONSE deny，payload
    含 session_id / request_id / decision='deny'，message 为
    PLATFORM_PERMISSION_DROPPED: {reason} — retry in a new turn，并对齐
    :1503-1510 超时 deny 先例带 runtime_id ack 键（取不到 runtime_id 时条件省略该键）；
    发送失败仅 log.warning 不抛异常。"
  - handle_permission_request 各校验失败分支（session 不存在 / 无 runtime / daemon
    不匹配 / session 非 active / manual_approval 关闭 / run 不匹配 / run 非 active
    turn）return False 前统一调 _deny_respond；既有校验顺序不动。
  - "payload.background_task is True 时把 current_run 校验块（:423 run 匹配 +
    :432 active-turn）整体替换为「按 payload.run_id 直查 AgentRun +
    run.agent_session_id == session_id 归属校验」，其余校验与顺序保持不变。"
acceptance:
  - background_task=True 且 run 已 completed 的请求仍被受理（return True）。
  - background_task=True 且 run.agent_session_id 与 session_id 不匹配的请求被拒收
    （return False）且 hub 收到 deny。
  - 各校验失败分支以 mock hub 断言 deny payload（decision / message / runtime_id
    键形态）。
  - 既有 fail-soft 断言（return False 不变）相关测试确认通过。
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_permissions.py app/modules/daemon/tests/test_ws_hub_permission.py app/modules/daemon/tests/test_permission_http_uplink.py -q --no-cov
constraints:
  - 注释与实现一致（CLAUDE.md 规则18）。
  - 不引入无关变更；background_task 非 True 时校验路径行为与现状一致。
  - 不许跑全量测试套件（CLAUDE.md 规则0）。
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
