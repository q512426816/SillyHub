---
id: task-08
title: 'SSE 端点 GET /api/notifications/events（服务端过滤+keepalive+清理）'
title_zh: 'SSE 端点 GET /api/notifications/events（服务端过滤+keepalive+清理）'
author: 'qinyi'
created_at: 2026-08-29 21:04:42
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-003@v2]
allowed_paths:
  - backend/app/modules/notification/router.py
  - backend/app/modules/notification/tests/test_router.py
goal: >
  新增 SSE 端点 GET /api/notifications/events，照抄 daemon sessions/events 模式实现
  实时通知推送（服务端按接收人过滤 + keepalive + finally 清理，design §7.2）。
implementation:
  - 对照 daemon/router.py:2437 stream_sessions_events 端点与 :2867 _stream_sessions_events 生成器实现同构端点
  - 端点级短 session 鉴权取当前用户，生成器内不注入请求级 DB session
  - 订阅 notifications:new 频道，仅当 payload.recipient_user_ids 含当前用户才下发 event notification 与 data
  - 加 keepalive 心跳防饥饿，finally 中清理 pubsub 连接
  - 不实现 Last-Event-ID 回放（漏发由前端重连后列表查询兜底）
  - tests/test_router.py 覆盖鉴权、含/不含当前用户的过滤下发与断开清理
acceptance:
  - SSE 行为与 sessions/events 先例一致：鉴权在端点层、过滤在服务端、断连清理无泄漏
  - 未含当前用户的事件不下发；keepalive 周期性发送
  - pytest backend/app/modules/notification/tests/test_router.py 通过
verify:
  - cd backend && python -m pytest app/modules/notification/tests/test_router.py -q
constraints:
  - router.py 内本 task 只负责 SSE 段，REST 段归 task-07（W4 在 W3 之后串行执行，避免同文件并行覆盖）
  - 不做 Last-Event-ID 回放，不改 service 层
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
