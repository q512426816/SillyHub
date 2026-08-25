---
id: task-08
title: '创建会话落绑定 + SessionCreateRequest.quicklog_id + 既有创建测试更新'
title_zh: '创建会话落绑定 + SessionCreateRequest.quicklog_id + 既有创建测试更新'
author: 'qinyi'
created_at: 2026-08-25 22:54:07
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-04, FR-06, D-002@v1]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/tests/test_change_session.py
  - backend/app/modules/daemon/tests/test_session_create_config.py
  - backend/app/modules/daemon/tests/test_session_router.py
provides:
  - contract: SessionCreateRequest
    fields:
      - quicklog_id
goal: >
  创建会话落绑定（FR-04 / FR-06 落点）——SessionCreateRequest 新增 quicklog_id
  可选短码字段并透传 service；创建落库点在 change_id 存在时补写
  change_session_links（单 FK 照写双写，D-002）、quicklog_id 存在时写
  quicklog_session_links（bind_session_to_quicklog savepoint best-effort）——
  门户 / 悬浮球从快速修复上下文发起的会话创建即自动建立关联。
implementation:
  - 'daemon/schema.py SessionCreateRequest 加 quicklog_id——str | None 缺省 None（ql_id 短码字符串非 UUID，max_length 128 对齐 AgentLogEntry.quick_id 形态）；不传零回归，不影响 runtime_id 与 provider 二选一校验'
  - 'daemon/router.py create_session 透传 quicklog_id=data.quicklog_id（对齐 change_id 既有透传形态）'
  - 'daemon/session/service.py 创建落库点（AgentSession add+flush 段 L1075-1091 之后）——change_id 存在时补写 change_session_links 行（agent_sessions.change_id 单 FK 列照写，D-002 双写）；quicklog_id 存在时 from app.modules.change.binding import bind_session_to_quicklog 落 workspace_id 加 quicklog_id 加 session.id 的绑定行'
  - 'workspace_id 取创建参数（与 AgentSession 行同值）；bind_session_to_quicklog 自带 savepoint + log.warning 不抛（task-02 契约），绑定失败不回滚创建主事务、不影响 201 返回'
  - '既有创建测试更新——test_change_session.py 补 change_id 创建后单 FK 与 links 双写断言；test_session_create_config.py 与 test_session_router.py 补 quicklog_id 用例（带 quicklog_id 创建成功后 quicklog_session_links 出行、不带零回归）'
  - 'openapi 类型再生成与前端契约归 task-09（plan 审 7-g2），本卡不跑 gen:types'
acceptance:
  - 'POST /api/daemon/sessions 带 change_id 创建成功——agent_sessions.change_id 单 FK 照写且 change_session_links 出现绑定行（D-002 双写）'
  - '带 quicklog_id 创建成功——quicklog_session_links 出现该 workspace 加 ql_id 加 session 的绑定行，可经 task-07 新端点回读'
  - '不带 quicklog_id 与 change_id 的旧请求体创建路径零回归——现有创建测试不改断言全绿'
  - 'quicklog 绑定写入异常仅 log.warning，会话创建仍返回 201'
verify:
  - cd backend && uv run pytest app/modules/daemon/tests -q -k session
constraints:
  - 'schema.py / router.py / session/service.py 与 task-04 同文件但分属 W3 / W2 两 Wave 允许——本卡只动创建链（quicklog_id 字段加落绑定），不动列表筛选（ql_id 查询参数与 change_id M:N 子查询归 task-04）'
  - 'quicklog_id 不做条目存在性校验（无 FK，D-001 允许条目行后到）；不迁移不删除 agent_sessions.change_id 单 FK（D-002 冻结语义）'
  - '不动 inject / end / reopen 等既有会话生命周期路径；绑定只走 change.binding 公共入口禁止直写表'
  - 'pnpm gen:types 与 api-types.ts / openapi.json 提交归 task-09'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
