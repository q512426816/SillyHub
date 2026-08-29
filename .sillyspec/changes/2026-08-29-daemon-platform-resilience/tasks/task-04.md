---
id: task-04
title: backend-control-command-dispatch-pull-ack-heartbeat-gc
title_zh: backend 下发方接入控制指令＋补拉与 ACK 端点＋心跳 pending_controls 扩展＋控制指令 GC 挂载
author: 'qinyi'
created_at: 2026-08-29 03:07:34
priority: P0
depends_on: [task-01, task-03]
blocks: [task-06, task-09]
requirement_ids: [FR-01]
decision_ids: [D-005@v1, D-006@v1, D-007@v1]
allowed_paths:
  - backend/app/modules/daemon/control_commands.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/permission_service.py
  - backend/app/modules/daemon/lease/provider_switch.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/runtime/service.py
  - backend/app/modules/daemon/tests/test_control_command_dispatch.py
  - backend/app/main.py
  - backend/app/modules/daemon/tests/test_session_switch_config.py
goal: >
  把六类控制指令下发从裸 WS 直推进化为落库待发＋WS 推送＋补拉 ACK 三段式（delivered 不重发保零重复），补齐 pending-controls 与 ack 端点、心跳 pending_controls 计数和 GC 过期联动 run failed，实现断线窗口控制指令零丢失。
implementation:
  - 在 control_commands.py（task-01 落地的 ControlCommandService 之上）补下发编排助手——enqueue 落 pending 行后经 ws_hub 按现有消息形状推送并把 command_id 注入 payload，推送成功 mark_delivered，失败或不在线保持 pending
  - session/service.py 四类会话指令接入控制通道——inject（首 turn 与后续 turn）、interrupt、end、resume（reopen 租约）改走 enqueue 助手，payload 注入 command_id 向后兼容旧 daemon
  - permission_service.py 的审批结果 PERMISSION_RESPONSE 与 5min 超时 deny 两处、lease/provider_switch.py 的 PROVIDER_CONFIG_CHANGED 同改 enqueue 通道，消除下发侧裸 WS 直推
  - router.py 新增 GET /api/daemon/runtimes/{id}/pending-controls（runtime 鉴权，仅返回 pending 行，created_at 升序）与 POST /api/daemon/runtimes/{id}/controls/ack（ids 数组，pending 或 delivered 均可置 acked，消费失败的业务性错误同样 ack 防毒丸）
  - runtime/service.py 心跳响应扩展 pending_controls 计数（该 daemon 全部 runtime 的 pending 控制指令数），字段名与 daemon 对账触发约定统一
  - 控制指令 GC 挂载 task-03 常驻 sweeper 轮内执行——pending 超 expires_at 与 delivered 未 ack 超 10min 均置 expired、acked 保留 1h 后删除；inject 类两条过期路径联动把对应 pending run 幂等标 failed（error_code 沿用 session/service.py 既有 interactive_inject_send_failed 先例）
  - 新增 tests/test_control_command_dispatch.py 覆盖下发状态机、补拉仅 pending、ack、心跳计数与 GC 过期联动
acceptance:
  - 六类指令（session_inject/interrupt/end/resume、permission_response、provider_config_changed）全部经 enqueue 通道下发且 payload 带 command_id，消息形状与其余字段不变（旧 daemon 忽略新字段）
  - WS 推送失败或不在线时指令保持 pending 不丢；补拉只返回 pending 行，delivered 一律不重发（零重复执行）
  - ack 后状态翻 acked 并返回 acked 计数；消费失败的业务性错误同样 ack 不无限重投
  - 心跳响应携带 pending_controls 且与该 daemon 全部 runtime 的 pending 行数一致
  - inject 指令 pending 过期与 delivered 未 ack 10min 过期两条路径均把对应 run 标 failed（error_code=interactive_inject_send_failed）且重复 GC 轮幂等不重复写
  - 未触发新链路时既有 WS 推送、心跳与会话状态机行为零回归
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_control_command_dispatch.py -q
  - cd backend && uv run pytest app/modules/daemon/tests/test_register_heartbeat_daemon.py app/modules/daemon/tests/test_session_service.py app/modules/daemon/tests/test_session_permissions.py -q
constraints:
  - 补拉只返回 pending、delivered 一律不重发（D-006 零重复执行铁律——inject 重复执行会双发 prompt 不可接受）
  - 不改 sweep.py 与 main.py——GC 入口在 control_commands.py 内交付，由 task-03 常驻 sweeper 调用挂载
  - payload 仅新增可选 command_id 字段，现有控制消息形状与其余字段逐字节不变（向后兼容）
  - 不动 AgentSessionQueuedMessage 排队层（业务层排队与投递层可靠正交）；expires_at 按 kind 取值（inject 10min、permission_response 6min、其余 30min）沿用 task-01 表定义
  - 仅跑本卡相关测试，全量留 CI
expects_from:
  task-01:
    - contract: ControlCommandService
      needs: [enqueue, mark_delivered, fetch_pending, ack, gc]
related_tests:
  - path: backend/app/modules/daemon/tests/test_session_switch_config.py
    reason: SESSION_INJECT payload 注入 command_id 后精确键集断言需同步（execute 主代理兜底修复）
provides:
  - contract: ControlCommandItem
    fields: [id, kind, payload, created_at]
  - contract: ControlsAckResponse
    fields: [acked]
  - contract: HeartbeatPendingControls
    fields: [pending_controls]
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
