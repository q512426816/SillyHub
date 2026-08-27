---
id: task-01
title: 'Backend binding foundation: ppm_item_session_links table + Alembic migration + bind/workspace/item helpers + GET /api/ppm/item-sessions (W1)'
title_zh: '后端绑定基座——ppm_item_session_links 表 + Alembic 迁移 + bind helper + 读取端点（W1）'
author: 'qinyi'
created_at: 2026-08-28 03:19:00
priority: P0
depends_on: []
blocks: [task-02]
requirement_ids: [FR-01]
decision_ids: [D-005@v1, D-004@v2]
allowed_paths:
  - backend/app/modules/ppm/common/session_binding.py
  - backend/app/modules/ppm/common/router.py
  - backend/app/modules/ppm/common/__init__.py
  - backend/app/modules/ppm/common/tests/test_session_binding.py
  - backend/app/main.py
  - backend/migrations/versions/
provides:
  - contract: PpmItemSessionLink
    fields: [kind, item_id, session_id, workspace_id]
  - contract: bind_session_to_ppm_item
    fields: [db, workspace_id, kind, item_id, session_id]
  - contract: resolve_item_workspace_id
    fields: [db, kind, item_id, "return: uuid|None"]
  - contract: load_ppm_item
    fields: [db, kind, item_id, "return: PlanTask|PpmProblemList|None"]
  - contract: load_item_files
    fields: [db, kind, item_id, "return: list[File]（file_urls 存活行）"]
  - contract: "GET /api/ppm/item-sessions"
    fields: [kind, item_id, "response: AgentSessionListItem 列表（同 change sessions 结构）"]
goal: >
  建立 PPM 任务/问题↔会话的后端绑定基座（ppm_item_session_links 表 + Alembic 迁移 +
  幂等 bind / 工作区解析 / item 与 File 读取 helper + GET /api/ppm/item-sessions
  读取端点），供 task-02 通道接线与 task-03 上下文注入消费（FR-01；D-005@v1 单表
  kind 绑定，D-004@v2 工作区排序键定死 workspace_id 升序）。
implementation:
  - 新建 backend/app/modules/ppm/common/session_binding.py：ORM 表 PpmItemSessionLink（__tablename__="ppm_item_session_links"，kind String("plan_task"|"problem") + item_id Uuid 软关联无 FK（对齐 QuicklogSessionLink 模式，change/model.py:291——PPM 数据可由同步写入，硬 FK 会拦删除）+ session_id FK agent_sessions.id ON DELETE CASCADE + workspace_id Uuid 可空 + created_at，UniqueConstraint("kind","item_id","session_id") + (kind,item_id) 查询索引，列风格对齐 change/model.py:247 ChangeSessionLink）
  - 同文件实现 bind_session_to_ppm_item(db, *, workspace_id, kind, item_id, session_id)：按 (kind,item_id,session_id) 查存在即返回，否则插行；整体 begin_nested savepoint + flush 不自行 commit，异常仅 log.warning 不抛（对齐 change/binding.py bind_session_to_quicklog 幂等 best-effort 风格）
  - 同文件实现 resolve_item_workspace_id(db, kind, item_id) -> uuid|None：load item → item.project_id → 查 ppm_project_workspace（workspace/model.py:181）ORDER BY workspace_id ASC LIMIT 1（D-004@v2：表无时间列且现有查询无排序，显式定死排序键）；item 不存在或项目无关联工作区返回 None
  - 同文件实现 load_ppm_item(db, kind, item_id)：kind=plan_task 按 id 查 ppm/task/model.py PlanTask；kind=problem 按 id 查 ppm/problem/model.py PpmProblemList；查无返回 None 不抛
  - 同文件实现 load_item_files(db, kind, item_id) -> list[File]：读 item.file_urls 逐条 uuid 解析（非 uuid 条目跳过，R-03），File.id IN (...) 且 deleted_at IS NULL 批量取存活行（file/model.py:24）
  - 新建 backend/migrations/versions/<rev>_add_ppm_item_session_links.py：dialect 无关 create_table + 唯一约束 + 索引（对齐 20260825230000_add_quicklog_session_links 先例）；写前先 uv run alembic heads 确认单头（当前观察 head=20260827230000，R-01 撞号防线）再接 down_revision；downgrade 仅 drop 表（无数据迁移副作用，§9）
  - 新建 backend/app/modules/ppm/common/router.py：APIRouter(tags=["ppm-common"])，GET /item-sessions?kind=&item_id=（kind Query Literal["plan_task","problem"] 必填，非法值 422；鉴权对齐 ppm/task/router.py get_current_principal 仅认证口径），PpmItemSessionLink JOIN AgentSession（deleted_at IS NULL）按 kind+item_id 过滤，响应复用 daemon/schema.py AgentSessionListItem（author 展示名 + 首条 user_input 标题摘要 + last_active_at desc，同构 change/router.py:366 list_change_sessions）
  - backend/app/main.py：import 并 app.include_router(ppm_common_router, prefix="/api/ppm")（照 :787 ppm_plan_router 挂载形态）；ppm/common/__init__.py 的 __all__ 按需增补 session_binding/router
  - 新建 backend/app/modules/ppm/common/tests/test_session_binding.py（root conftest 的 client/auth_headers/db_session fixtures + 测试模块内 import 注册 AgentSession/workspace 模型）：bind 幂等（重复执行不报错不重行）；resolve 两关联工作区断言取 workspace_id 升序第一个、无关联返回 None；load_ppm_item 命中与 None；load_item_files 存活行过滤与非 uuid 剔除；端点返回关联会话列表 + kind 非法值 422 + 无关联返回 []
acceptance:
  - alembic upgrade head 后 ppm_item_session_links 表存在且唯一约束 (kind,item_id,session_id) 生效；downgrade 可回退（仅 drop 表）
  - bind_session_to_ppm_item 对同一 (kind,item_id,session_id) 重复执行不抛异常且表中仅一行
  - GET /api/ppm/item-sessions?kind=plan_task&item_id=<uuid> 返回该 item 关联会话列表（结构同 GET /changes/{id}/sessions：id/provider/status/turn_count/mode/author/last_active_at/title）；kind=foo 非法值返回 422；无关联返回 []
  - resolve_item_workspace_id 对多关联工作区项目返回 workspace_id 升序第一个（D-004@v2）；item 不存在/项目无关联工作区返回 None
verify:
  - cd backend && uv run pytest app/modules/ppm/common/tests/test_session_binding.py -q
  - cd backend && uv run alembic heads && uv run alembic upgrade head
  - cd backend && uv run ruff check app/modules/ppm
constraints:
  - 不改 change/quicklog 既有表与绑定通道（change_session_links/quicklog_session_links 与 change/binding.py 零改动）
  - item_id 软关联无 FK；不修改 ppm_plan_task/ppm_problem_list/file 表结构（design §8）
  - 不接线任何写入方（create/inject 通道归 task-02），不实现上下文前导与附件物化（归 task-03）
  - 迁移 dialect 无关（PG/SQLite 双方言可建表）；代码兼容 Windows/Linux/macOS
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
