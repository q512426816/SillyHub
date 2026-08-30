---
id: task-07
title: 'REST 四端点 + schema DTO + main.py 路由注册'
title_zh: 'REST 四端点 + schema DTO + main.py 路由注册'
author: 'qinyi'
created_at: 2026-08-29 21:04:42
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-08]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/notification/router.py
  - backend/app/modules/notification/schema.py
  - backend/app/main.py
  - backend/app/modules/notification/tests/test_router.py
provides:
  - contract: NotificationRead
    fields: [id, workspace_id, type, title, body, link, ref_type, ref_id, read_at, created_at]
  - contract: NotificationListResponse
    fields: [items, total]
  - contract: UnreadCountResponse
    fields: [count]
goal: >
  在 notification 模块新增 router.py 的四个 REST 端点与 schema.py DTO，并在 main.py
  注册路由，为前端通知面板提供列表/未读数/已读接口（design §7.2）。
implementation:
  - schema.py 定义 NotificationRead / NotificationListResponse / UnreadCountResponse / 标记已读响应（updated）DTO，字段风格对齐既有模块 schema.py
  - router.py 实现 GET /api/notifications（?limit=20&offset=0&unread_only=false，仅本人，created_at DESC）、GET /api/notifications/unread-count、POST /api/notifications/{id}/read（越权/不存在 404）、POST /api/notifications/read-all
  - 调用 task-02 的 NotificationService 对应方法，错误用 AppError 子类（见 core/errors.py 惯例）
  - main.py 按既有 include_router 惯例注册 notification 路由
  - tests/test_router.py 覆盖四端点（本人过滤、404、read-all）
acceptance:
  - 四端点行为符合 design §7.2 表格，DTO 字段与 provides 契约一致
  - 越权或不存在 id 返回 404，read-all 返回 updated 计数
  - pytest backend/app/modules/notification/tests/test_router.py 通过
verify:
  - cd backend && python -m pytest app/modules/notification/tests/test_router.py -q
constraints:
  - router.py 内本 task 只负责 REST 段，SSE 段归 task-08（同 Wave 并行，execute 时按任务串行/协调执行避免冲突）
  - 通知发送/幂等逻辑不在此实现，只调用 service 方法
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
