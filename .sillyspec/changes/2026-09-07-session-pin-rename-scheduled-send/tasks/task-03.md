---
id: task-03
title: 'scheduled-message-crud-endpoints'
title_zh: '定时消息增删查三端点——创建校验、列表与取消'
author: 'qinyi'
created_at: 2026-09-07 23:32:13
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1, D-002@v1]
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
  - contract: ScheduledMessageRead
    fields: [id, prompt, dispatch_at, status, error_code, error_message, cancelled_at]
    consumers: [task-05]
goal: >
  为定时发送补齐 CRUD 侧——创建（未来时间与内容校验）、列表、取消三个端点与 schema/service 实现，落库 pending 条目供 task-04 sweeper 到点派发（D-001@v1 方案 B，仅一次性）。
implementation:
  - schema.py 新增 ScheduledMessageCreateRequest（prompt str、dispatch_at datetime、attachment_ids 列表可空、agent_profile_id 与 llm_provider_id 均 str 可空）与 ScheduledMessageRead（id、agent_session_id、prompt、dispatch_at、status、attachment_ids、agent_profile_id、llm_provider_id、error_code、error_message、created_at、dispatched_at、cancelled_at，from_attributes 直映射）——字段与 design §接口定义逐一对应
  - session/service.py 的 SessionService 新增 create_scheduled_message（签名照 design §接口定义）——行锁取归属会话（404）后三重校验——prompt strip 非空（attachment_ids 非空豁免，对齐 inject 口径）否则 AppError 422、dispatch_at 早于 now(UTC)+60s 则 422、会话终态（ended/failed）或 deleted_at 非空则 409；通过后落库一行 status=pending、sender_user_id=当前用户、attachment_ids 转 str 列表快照、其余快照字段原样保存，commit 后返回 ORM 行
  - 同文件新增 list_scheduled_messages（归属过滤返回全部状态条目按 dispatch_at 升序）与 cancel_scheduled_message（行锁取条目并复核归属 404，status 非 pending 抛 409，pending 置 cancelled 并写 cancelled_at=now(UTC) 后 commit）
  - router.py 新增三端点（TaskRunAgentUser 鉴权、SessionDep）——POST /sessions/{session_id}/scheduled（201，body 为 ScheduledMessageCreateRequest，响应 ScheduledMessageRead）、GET 同路径返回 ScheduledMessageRead 列表、DELETE /sessions/{session_id}/scheduled/{message_id}（204）；service.py 门面照 archive 一行委托模式加三个委托
acceptance:
  - 创建成功 201——落库 status=pending、快照字段（prompt/attachment_ids/agent_profile_id/llm_provider_id）原样保存、sender_user_id 记账创建者（FR-04）
  - 创建校验——dispatch_at 早于 now+60s 或 prompt 与附件全空返回 422、终态或软删会话返回 409、非属主或不存在返回 404，均不落库
  - 列表按 dispatch_at 升序含全部状态；取消 pending 条目置 cancelled 并写 cancelled_at 返回 204，非 pending 条目取消返回 409
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto
constraints:
  - 不实现 sweeper 派发（scheduled_send.py 归 task-04）、不写新测试文件（归 task-06）、不改前端与 api-types（归 task-05）、不动 inject/queue 既有链路
  - 与 task-02 共享 schema/router/service/session-service 四文件——须在 task-02 合入后开工（plan Wave 3 串行约定）；错误码口径对齐 FR-04（422/409/404）
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
