---
id: task-09
title: 'Notification type=agent_blocked——120s 阈值/段级 dedupe/与 5min auto-deny 同源分级/Redis 推'
title_zh: 'Notification type=agent_blocked——120s 阈值/段级 dedupe/与 5min auto-deny 同源分级/Redis 推'
author: 'qinyi'
created_at: 2026-09-07 13:43:27
priority: P0
depends_on: ['task-08']
blocks: []
requirement_ids: [FR-04]
decision_ids: ['D-001@v1', 'D-003@v1']
allowed_paths:
  - backend/app/modules/notification/service.py
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/notification/tests/test_agent_blocked_notify.py
  - backend/app/modules/platform_sync/tests/test_agent_log_states_push.py
target_files:
  - backend/app/modules/notification/service.py
  - backend/app/modules/platform_sync/service.py
  - NEW:backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py
  - NEW:backend/app/modules/platform_sync/tests/test_agent_log_states_push.py
goal: >
  Notification 新 type=agent_blocked：blocked 持续 ≥120s 未消解触发站内通知（120s
  轻提醒与既有 5min auto-deny 同源分级），段级 dedupe（dedupe_key=
  {session_ref}:blocked:{段序号}），复用 Redis notifications:new 推送
  （design §5.3/§7/§7.5，FR-04）。
implementation:
  - 'notification/service.py：NotificationType Literal（:33）增 agent_blocked + 常量 BLOCKED_ALERT_SEC=120（design §7 阈值常量起步）；通知方法定向会话 owner（notify_user），未归属裸会话回落 notify_broadcast 持 CHANGE_CREATE 全员（先例 platform_sync/service.py _broadcast_pending_approval :294 的权限扇出范式）'
  - 'dedupe 语义：dedupe_key={session_ref}:blocked:{段序号}（段序号按该会话既有 agent_blocked 通知计数推进，不落新列）；同一 blocked 段只发一次——复用 _has_unresolved（:314）未消解存在性检查；blocked 消解（states 上报转移到非 blocked）调 resolve_pending（:197）置已读，再进入即新段可再发（R-05）'
  - '触发点接线：platform_sync/service.py 的 upsert_agent_log_states（task-08）落库后，对 state=blocked 且段起点距今 ≥120s 的行 best-effort 触发（整体 try 仅 log.warning，仿 _broadcast_pending_approval :294 范式不阻断上报主流程）；payload 含 harness、session 短 id、ctx(change_key|quick_id)、等待时长、待审记录 ref（与既有 permission_request 同源引用待审记录，独立 type 不重复打扰）'
  - 'model.py：type String(40) 自由值无迁移，§7.1 注释四类扩五类（+agent_blocked）；schema.py：核对 NotificationRead.type 为自由 str 无 Literal 校验（design 自审存疑二核对项），同步渲染语义注释；events.py/InAppChannel：复用 NOTIFICATIONS_CHANNEL（:19）publish_notifications_new 推送，payload 需带等待时长字段时在 deliver 构造处透传（保持既有订阅方兼容）'
  - '新建 test_agent_blocked_notify.py：段起点 <120s 不发、≥120s 发；同一 blocked 段重复上报只发一次；消解后再进入段序号+1 可再发；idle/working/unknown 会话不产生 agent_blocked（R-01 铁律回归）；Redis 走 notifications:new 频道断言；并在 test_agent_log_states_push.py 补端到端触发断言（states 上报 → 通知落库）'
acceptance:
  - 'blocked 持续 ≥120s 时 agent_blocked 通知落库并经 Redis notifications:new 推送；blocked <120s 不发'
  - '同一 blocked 段只发一次通知；blocked 消解后再次进入视为新段（段序号+1）可再次通知'
  - '空闲会话（idle/working/unknown）不产生 agent_blocked 通知（R-01 回归）'
  - '既有 permission_request/permission_timeout 通知测试零回归（不与 permission 通知重复打扰，R-05）'
  - 'type 值 agent_blocked 落库成功且无 Notification 新迁移（String(40) 自由值）'
verify:
  - 'cd backend && uv run pytest app/modules/notification/tests -n auto -k agent_blocked'
  - 'cd backend && uv run pytest app/modules/notification/tests -n auto'
  - 'cd backend && uv run pytest app/modules/platform_sync/tests -n auto -k agent_log_states'
  - 'cd backend && uv run ruff check app/modules/notification && uv run mypy app/modules/notification app/modules/platform_sync/service.py'
constraints:
  - '通知 dedupe 不与既有 permission 通知重复打扰：独立 type + 段级 dedupe_key，payload 引用同一待审记录 ref（R-05 同源分级：120s 提醒 / 5min 拒绝照旧）'
  - '不动 daemon 侧 5min auto-deny（permission_service PERMISSION_TIMEOUT_SEC=300 照旧），本卡只在 backend 加 120s 轻提醒层'
  - '通知失败不阻断 states 上报主流程（best-effort try 包裹，D-006@v1 先例）；不新增 Notification 列/迁移，段序号计算不落新列'
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
