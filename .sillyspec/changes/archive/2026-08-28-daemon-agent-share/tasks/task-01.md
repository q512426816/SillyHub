---
id: task-01
title: create-grants-data-model-and-migration
title_zh: 'grants 数据层——`daemon_runtime_grants` 模型 + Alembic 迁移（建表 NULLS NOT DISTINCT / daemon_borrow_audit 加 grant_id / 存量 shared=true 迁移跳过 daemon_id NULL 行）+ 单测'
author: 'qinyi'
created_at: 2026-08-28 01:24:05
priority: P0
depends_on: []
blocks: ['task-02', 'task-04']
requirement_ids: [FR-01, FR-04]
decision_ids: [D-006@v1, D-008@v1]
allowed_paths:
  - backend/app/modules/daemon/grants/
  - backend/app/modules/daemon/grants/tests/
  - backend/migrations/versions/
  - backend/app/modules/agent/model.py
goal: >
  新建 daemon_runtime_grants 统一授权表（模型 + Alembic 建表迁移 + 存量 shared=true
  数据迁移 + daemon_borrow_audit 加 grant_id），为工作区共享与平台共享智能体提供唯一授权数据源。
implementation:
  - 新建 backend/app/modules/daemon/grants/ 子包（__init__.py + model.py），组织参照 daemon/session/ 子包、列风格模仿 daemon/model.py 的 sa_column Column 加 server_default 惯例
  - DaemonRuntimeGrant 按 design §8 定义各列——id 主键、daemon_instance_id 外键 daemon_instances、grantee_type 取 workspace 或 platform（user 预留枚举位）、grantee_id 可空（platform 行为 NULL）、granted_by_user_id 外键 users、platform 绑定列 agent_profile_id 与 source_workspace_id 与 pinned_runtime_id 与 writable_dir（可空）、enabled 默认 true、created_at 与 updated_at；附 (grantee_type, grantee_id) 与 granted_by_user_id 索引
  - 新 Alembic 迁移（down_revision 接当前单 head 20260827230000，文件名沿 yyyymmddHHMMSS_ 前缀惯例）——建 daemon_runtime_grants 表，唯一约束 (daemon_instance_id, grantee_type, grantee_id, granted_by_user_id) 以 NULLS NOT DISTINCT 下发（sa.UniqueConstraint nulls_not_distinct=True 或原生 DDL 兜底）
  - 同迁移给 daemon_borrow_audit 加 grant_id uuid 可空列（无 FK 硬约束，grant 物理删除后审计行仍可读），并同步修改 backend/app/modules/agent/model.py 的 DaemonBorrowAudit 模型加同名列
  - 存量迁移段——遍历 workspace_member_runtimes 中 shared=TRUE 行逐条生成 workspace grant（grantee_id=workspace_id、granted_by_user_id=binding.user_id、daemon_instance_id=binding.daemon_id），daemon_id IS NULL 的行跳过并写日志记录跳过计数
  - 新增 grants/tests/ 单测——建表 DDL 与模型列映射、platform 行（grantee_id 为 NULL）重复插入被唯一约束拒绝、存量迁移正常行与 daemon_id NULL 跳过行两分支、borrow 审计 grant_id 列存在
acceptance:
  - daemon_runtime_grants 模型与迁移建表列一一对应（design §8），唯一约束 DDL 含 NULLS NOT DISTINCT，迁移后 alembic 保持单 head
  - daemon_borrow_audit.grant_id 列存在、nullable、无 FK 硬约束，模型与迁移两侧同步
  - 存量 shared=true 且 daemon_id 非空的行迁移后逐行生成 enabled=true 的 workspace grant；daemon_id IS NULL 行被跳过且日志含跳过计数
  - grants 新增单测全部通过
verify:
  - cd backend && uv run pytest app/modules/daemon/grants -q --no-cov -n auto
  - cd backend && uv run alembic heads
constraints:
  - 唯一约束 DDL 必须带 NULLS NOT DISTINCT（PG16，deploy 为 postgres:16-alpine；默认 NULLS DISTINCT 语义 NULL 不相等会使 platform 行重复插入，D-008）
  - 存量迁移跳过 daemon_id IS NULL 的 shared 行（现存此类 binding 且原借用 SQL 本就过滤）并写日志（D-008）
  - 项目未上线允许直接迁移不做在线双写；WorkspaceMemberRuntime.shared 列本卡不动（保留为缓存，开关双写归 task-06）
  - 本卡仅数据层——不实现授权判定（task-02）、不改 session 与 placement 与 borrow_resolver 调用方
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
