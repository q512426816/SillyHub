---
id: task-02
title: 'implement-notification-service-and-channel-abstraction'
title_zh: '实现 NotificationService 与 NotificationChannel 通道抽象（InAppChannel + events.py 发布助手，幂等/消解/独立事务）'
author: 'qinyi'
created_at: 2026-08-29 21:04:42
priority: P0
depends_on: ['task-01', 'task-03']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-003@v2, D-006@v1, D-009@v2]
allowed_paths:
  - backend/app/modules/notification/service.py
  - backend/app/modules/notification/events.py
  - backend/app/modules/notification/tests/test_service.py
provides:
  - contract: NotificationService.notify_broadcast
    fields: [workspace_id, permission, type, title, body, link, ref_type, ref_id, dedupe_key]
  - contract: NotificationService.notify_user
    fields: [workspace_id, recipient_user_id, type, title, body, link, ref_type, ref_id]
  - contract: NotificationService.resolve_pending
    fields: [ref_type, ref_id, types]
goal: >
  按 design §7.1 实现 notification 模块的服务层——NotificationService（广播/定向/消解三类核心方法）
  与 NotificationChannel 通道抽象（InAppChannel 走 Redis publish，events.py 提供镜像 daemon/session_events.py
  的 best-effort 发布助手），幂等检查收敛在 service 内、方法内独立事务提交，为三个触发点（task-04/05/06）提供统一契约。
implementation:
  - 新建 backend/app/modules/notification/service.py，定义 NotificationType 四类字面量、NotificationChannel Protocol、InAppChannel（广播多行合并为一次 publish，失败仅 log.warning）与 NotificationService（channels 默认 InAppChannel，未来 IM 通道 append 即可，D-003@v2）
  - notify_broadcast 用 list_user_ids_with_permission（task-03 产物）反查收件人，逐人落库；幂等为 service 内「同 ref_type+ref_id+type 且 read_at IS NULL 的行存在则跳过返回 0」（D-009@v2），dedupe_key 仅审计列不参与检查
  - notify_user 定向单用户落库，recipient_user_id 为 None 时调用方跳过（service 不强制）；落库成功后走 channels deliver
  - resolve_pending 将同 ref 的未读待办批量置 read_at=now 并返回行数（D-007@v1 消解语义）；方法内独立 commit（触发点事务已提交后调用，失败不回滚主流程，D-006@v1）
  - 新建 events.py，定义 NOTIFICATIONS_CHANNEL 与 publish_notifications_new(payload)，异常仅 log.warning（镜像 backend/app/modules/daemon/session_events.py 先例）
  - 新建 backend/app/modules/notification/tests/test_service.py，覆盖幂等跳过、消解后可再通知、收件人集为空返回 0、publish 失败不抛、独立事务提交
acceptance:
  - notify_broadcast 对同 ref 未消解通知第二次调用返回 0 且不新增行；resolve_pending 后同 ref 可再次通知
  - InAppChannel deliver 的 Redis publish 抛异常时仅 log.warning，落库结果不受影响
  - 三个方法均在方法内 commit，调用方事务回滚不影响已落库通知
verify:
  - cd backend && python -m pytest app/modules/notification/tests/test_service.py -q
constraints:
  - 幂等检查只做 service 内存在性检查，不建唯一索引、不给 dedupe_key 建独立索引（D-009@v2）
  - 不改 Notification 模型与迁移（归 task-01），不实现 router/SSE 端点（归 task-03/batch C）
  - 全部投递 best-effort，任何通道失败不向上抛（D-006@v1）
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
