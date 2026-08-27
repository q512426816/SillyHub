---
id: task-02
title: 'Backend channels: create/inject ppm fields + create_session binding and workspace resolve + follow-up bind + sessions ppm filter (W2)'
title_zh: '后端创建/追问/列表通道——schema 新字段 + create_session 绑定与工作区解析 + inject 追问绑定 + 会话列表 ppm 筛选（W2, depends_on: task-01）'
author: 'qinyi'
created_at: 2026-08-28 03:19:00
priority: P0
depends_on: ['task-01']
blocks: [task-03, task-04]
requirement_ids: [FR-01, FR-02, FR-05]
decision_ids: [D-005@v1, D-004@v2]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/tests/test_ppm_session.py
  - backend/app/modules/daemon/tests/test_change_session.py
  - backend/app/modules/daemon/tests/test_session_service.py
  - backend/app/modules/daemon/tests/test_sessions_list_filters.py
expects_from:
  task-01:
    - contract: PpmItemSessionLink
      needs: [kind, item_id, session_id, workspace_id]
    - contract: bind_session_to_ppm_item
      needs: [db, workspace_id, kind, item_id, session_id]
    - contract: resolve_item_workspace_id
      needs: [db, kind, item_id, "return: uuid|None"]
    - contract: load_ppm_item
      needs: [db, kind, item_id, "return: PlanTask|PpmProblemList|None"]
    - contract: load_item_files
      needs: [db, kind, item_id, "return: list[File]（file_urls 存活行）"]
    - contract: "GET /api/ppm/item-sessions"
      needs: [kind, item_id, "response: AgentSessionListItem 列表（同 change sessions 结构）"]
provides:
  - contract: daemon_sessions_ppm_schema
    fields: [SessionCreateRequest.ppm_item_kind/ppm_item_id, SessionInjectRequest.bind_ppm_item_kind/bind_ppm_item_id, GET /api/daemon/sessions query ppm_item_kind/ppm_item_id]
  - contract: create_session_ppm_wiring
    fields: [ppm_item_kind, ppm_item_id]
related_tests:
  - backend/app/modules/daemon/tests/test_change_session.py
  - backend/app/modules/daemon/tests/test_session_service.py
  - backend/app/modules/daemon/tests/test_sessions_list_filters.py
goal: >
  打通 PPM 绑定的三条后端通道——创建会话携带成对 ppm 字段写 link 并解析工作区、
  追问 inject 幂等追加 link（不注入前导）、会话列表 ppm 维度筛选——消费 task-01
  绑定基座（FR-01/FR-02/FR-05；§9 兼容策略：不带参数零回归、item 不存在降级
  记 warning 不报错）。
implementation:
  - daemon/schema.py SessionCreateRequest 新增 ppm_item_kind（Literal["plan_task","problem"] | None）与 ppm_item_id（uuid.UUID | None），照 quicklog_id（:189 旁）成对 Optional 形态；model_validator 成对校验——只传其一 ValueError → 422；不纳入空 prompt 豁免
  - daemon/schema.py SessionInjectRequest 新增 bind_ppm_item_kind / bind_ppm_item_id（照 bind_change_key / bind_quick_id :254-255 模式，成对校验同上；绑定不是配置切换，不纳入空 prompt 豁免）
  - daemon/router.py 三层透传：create_session（:2288-2310）传 ppm_item_kind/ppm_item_id；inject_session（:2336-2353）传 bind_ppm_item_kind/bind_ppm_item_id；GET /sessions（:2033-2090）新增 ppm_item_kind（Literal 校验非法 422）+ ppm_item_id Query 参数透传（漏透传会 500，先例注释 :2347）
  - daemon/session/service.py create_session：写事务前 load_ppm_item（task-01）校验——查无记 log.warning("session_ppm_bind_item_missing") 降级为普通会话不报错（对齐 quicklog 容错，§9）；命中则 resolve_item_workspace_id 得 ppm_ws（D-004@v2 升序第一个）；AgentSession.workspace_id 未显式指定时回填 ppm_ws；写事务内 session flush 后（:1273-1285 quicklog 分支旁）调 bind_session_to_ppm_item(self._session, workspace_id=ppm_ws, kind, item_id, session.id)
  - create_session 前导注入留 task-03：本卡仅在 dispatch_prompt 前导段留接线占位注释（将消费 build_ppm_item_context_preamble），不实现前导与附件物化
  - daemon/session/service.py inject_session 追问绑定分支（:2325-2347，bind_change_key / bind_quick_id 旁）新增 ppm 分支：bind_ppm_item_* 成对携带时 load_ppm_item 校验（不存在仅 warning 跳过）→ bind_session_to_ppm_item 幂等追加，不注入前导
  - daemon/session/service.py list_agent_sessions（:4205 签名 / :4285-4307 筛选段）新增 ppm_item_kind / ppm_item_id：base_filters 追加 AgentSession.id IN (select(PpmItemSessionLink.session_id).where(kind、item_id 匹配))（照 change_id / ql_id 分支模式；item_id 为 UUID 全局唯一，无跨工作区串扰）
  - 新建 test_ppm_session.py（GWT，FR-01/02/05 后端段）：创建带成对字段写 link + workspace 解析；只传单个字段 422（create 与 inject 两通道）；item 不存在 201 降级 + warning；追问绑定幂等追加且 prompt 无 PPM 前导；列表 ppm 筛选命中/排除；不带参数行为不变
  - 既有测试适配（plan GAP-1）：test_session_service.py bind_* 用例组旁、test_sessions_list_filters.py ql_id 用例组旁按需补 ppm 对照断言；test_change_session.py 回归确认零改动通过
acceptance:
  - POST /api/daemon/sessions 携带成对 ppm_item_kind+ppm_item_id：ppm_item_session_links 落行（幂等不重行）；未显式传 workspace_id 且项目有关联工作区时 AgentSession.workspace_id 与 link.workspace_id 均为 workspace_id 升序第一个（D-004@v2）；无关联工作区两者留空且创建成功不报错
  - 只传 ppm_item_kind / ppm_item_id 其一 → 422（create 与 inject 两通道同口径）；GET /api/daemon/sessions 只传其一同口径 422
  - ppm_item_id 不存在/已删：创建与追问均不报错（201，降级普通会话），log.warning 落记录（§9）
  - inject 追问携带 bind_ppm_item_*：幂等追加 link（第二次调用不重行）且 dispatch_prompt 不含任何 PPM 前导（前导归 task-03）
  - GET /api/daemon/sessions?ppm_item_kind=&ppm_item_id= 命中已绑定会话、排除未绑定；kind 非法值 422
  - 不带 ppm 参数的创建/追问/列表请求行为与现状一致（既有 create/inject/list 用例零改动全绿，零回归）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests -q -k "session"
  - cd backend && uv run ruff check app/modules/daemon
constraints:
  - 不实现 PPM 前导注入与附件物化（build_ppm_item_context_preamble / materialize 归 task-03），本卡只留接线占位
  - 不反向修改 task-01 的 ppm/common/session_binding.py、ppm/common/router.py 与迁移（消费契约不漂移）；不改 change/quicklog 绑定通道与既有表
  - item 校验失败一律降级（warning + 跳过绑定段），禁止以 4xx/5xx 阻塞会话创建（§9）；不带 ppm 参数零回归
  - load_item_files 与 GET /api/ppm/item-sessions 的直接消费方是 task-03/前端（task-04/05），本卡经 expects_from 锁契约，不在 daemon 侧重复实现读取
  - schema 改动属后端 OpenAPI 变更（api-types.ts 重生成归 task-04，本卡不动前端）
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
