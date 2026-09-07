---
id: task-02
title: 'session-pin-unpin-rename-endpoints-sse-pinned-first-ordering'
title_zh: '会话置顶、取消置顶、重命名三端点与服务、SSE 同步与列表置顶优先排序'
author: 'qinyi'
created_at: 2026-09-07 23:32:13
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-06, FR-07]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/session/service.py
target_files:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/session/service.py
provides:
  - contract: AgentSessionRead
    fields: [pinned_at]
    consumers: [task-05]
goal: >
  实现会话属主三操作——SessionService 的 pin/unpin/rename 照 archive_session 模板（行锁归属、幂等早退、SSE 广播）+ 三个 PATCH 端点 + 列表排序置顶优先（分组内置顶、多置顶按最近活跃，D-002@v1）+ AgentSessionRead 下发 pinned_at。
implementation:
  - session/service.py 照 archive_session/unarchive_session 模板（行 6737-6805）新增 pin_session、unpin_session、rename_session（签名照 design §接口定义）——均以 with_for_update 行锁取归属会话（缺失或非属主一律 404 不泄露存在性），幂等早退 rollback 释放行锁（pin 遇已置顶、unpin 遇未置顶），pin 写 pinned_at=now(UTC)、unpin 清 pinned_at、rename 写 title 列，commit 后均调 publish_sessions_changed("status_changed", ...)（SSE 多端秒级同步，FR-06）
  - rename_session 的 title 先 strip 再校验非空且长度 ≤255，非法抛 AppError（422 语义、不落库）；列表标题派生（router 层 title 优先、回退首条 user_input）零改动，重命名天然优先生效
  - session/service.py 的 list_agent_sessions 排序键（行 6206-6210）改为 (pinned_at IS NULL) ASC 前置谓词 + 既有 coalesce(last_active_at, created_at) DESC + id DESC——多置顶之间按最近活跃排（D-002@v1），谓词在 SQL 层表达保证 aiosqlite/PG 双方言，前端分组桶按服务端序保序插入天然实现分组内置顶
  - schema.py 的 AgentSessionRead（行 25，archived_at 字段相邻处）加 pinned_at（datetime 可空、默认 None、from_attributes 直接映射守护旧行），并新增 SessionTitleUpdateRequest（title 字段 str，校验归 service 层）；router.py 照 archive/unarchive 端点（行 3623-3646）新增三个 PATCH 端点（均 204、TaskRunAgentUser 鉴权）——/sessions/{session_id}/pin、/sessions/{session_id}/unpin、/sessions/{session_id}/title（body 为 SessionTitleUpdateRequest）；service.py 门面（行 985-998 委托区）加三个一行委托；顺手修正 list_sessions（行 3029 起）与 list_agent_sessions 的 q 参数过时注释——title 已是持久列，q 实际匹配 user_input 内容 ilike 的口径如实描述（ISS-06），不改查询行为
acceptance:
  - pin 后该会话排其工作区分组最前、多置顶按最近活跃序，unpin 回到既有最近活跃序；重复 pin/unpin 幂等返回 204 且不刷新时间戳（FR-01/FR-02）
  - rename 落库后列表标题立即按 title 优先派生生效，title strip 后为空或超 255 字符返回 422 不落库（FR-03）
  - 非属主或不存在均 404 不泄露存在性；三操作成功后均 publish_sessions_changed 广播 status_changed（FR-06）；pinned_at 全 NULL 的存量数据列表序与升级前一致且 daemon 模块既有测试零回归（FR-07，R-03）
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto
constraints:
  - 不实现定时消息任何端点/schema/service（归 task-03，与其共享四文件须串行）；不写新测试文件（backend 测试归 task-06），不改前端与 api-types（归 task-05）
  - AgentSessionRead 仅新增 pinned_at 字段不动既有字段语义；SSE 复用既有 publish_sessions_changed 通道（reason 固定 status_changed）不加新事件类型；排序改动仅动 order_by 不动 base_filters 与分页逻辑
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
