---
id: task-01
title: '数据迁移 agent_kind→agent_kinds JSON（双方言+存量单值转数组+索引 drop/rebuild+对称 downgrade）'
title_zh: '数据迁移 agent_kind→agent_kinds JSON（双方言+存量单值转数组+索引 drop/rebuild+对称 downgrade）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 14:31:42
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: []  # (预填源未就绪：plan 阶段后跑 prefill-refresh)
allowed_paths:
  - backend/migrations/versions/
  - backend/app/modules/llm_provider/model.py
target_files:
  - NEW:backend/migrations/versions/20261006120000_provider_agent_kinds.py
  - backend/app/modules/llm_provider/model.py
goal: >
  把 llm_providers.agent_kind 单值列迁移为 agent_kinds JSON 数组列并同步 model.py 列定义（D-004）：
  存量单值转单元素数组（FR-02）、含 agent_kind 的复合索引显式 drop 后按 (user_id) 维度 rebuild（R-01）、
  提供对称 downgrade（数组取首元素）；项目未上线不留双列（规则 11）。
implementation:
  - 新建 NEW:backend/migrations/versions/20261006120000_provider_agent_kinds.py：revision="20261006120000"，down_revision 挂执行时 alembic 唯一当前 head（以 `alembic heads` 实查为准，不凭记忆写死——目录中有多个 merge_heads 文件，必须核对避免挂到已合并旧分支）
  - upgrade 顺序（SQLite/PG 双方言，R-03；PG 分支按 op.get_bind().dialect.name 守卫，先例 backend/migrations/versions/20260825150000_agent_run_logs_trgm_index.py:36）：① op.drop_index("ix_llm_providers_user_agent_default")——含 agent_kind 的复合索引必须先删，否则列替换报错（R-01）→ ② batch_alter_table("llm_providers") 加 agent_kinds JSON NOT NULL 列（对已有数据的表加 NOT NULL 列需 server_default 占位如 '[]'，batch_alter_table 保证 SQLite 重建表语义）→ ③ 回填 UPDATE 按 dialect 分支：PG 用 to_jsonb/jsonb_build_array(ARRAY[agent_kind])，SQLite 用 json_array(agent_kind) 兼容写法——每行 agent_kinds = [旧 agent_kind]（FR-02 值域不变性）→ ④ batch_alter_table 删 agent_kind 旧列 → ⑤ (user_id) 维度索引 rebuild（与既有 ix_llm_providers_user 等价时复用该索引即可，不强制新建重复索引；is_default 过滤转行级 Python 判断，R-01）
  - downgrade 对称（requirements 非功能「可回退」）：drop (user_id) 维度重建索引 → batch_alter_table 加回 agent_kind VARCHAR(32) NOT NULL（server_default 占位）→ 回填 agent_kind = agent_kinds 数组首元素（PG 用 ->>0，SQLite 用 json_extract(agent_kinds, '$[0]')）→ 删 agent_kinds 列 → 重建 ix_llm_providers_user_agent_default (user_id, agent_kind, is_default)
  - 同步 backend/app/modules/llm_provider/model.py:44-47：`agent_kind：str = Field(max_length=32, sa_column=Column(String(32), nullable=False))` 改 `agent_kinds：list[str] = Field(sa_column=Column(JSON, nullable=False))`（JSON 导入 model.py:18 已有）
  - 同步 backend/app/modules/llm_provider/model.py:127-130 __table_args__：ix_llm_providers_user_agent_default (user_id, agent_kind, is_default) 复合索引调整至迁移终态一致（drop 或 (user_id) 化），防 model/迁移漂移（model.py:8 既有「列定义须与迁移一一对应」惯例）
  - 迁移文件 docstring 记明双方言分支、索引 rebuild 口径与「不留双列」依据（design §数据模型 / 规则 11）
acceptance:
  - NEW:backend/migrations/versions/20261006120000_provider_agent_kinds.py 存在，revision=20261006120000 且 down_revision 等于执行时 `alembic heads` 的唯一 head
  - SQLite（测试环境）与 PG（生产语义）双方言下 `alembic upgrade head` 均执行成功（R-03）
  - 升级后 llm_providers 表：agent_kind 列不存在、agent_kinds JSON NOT NULL 列存在；每行 agent_kinds 为单元素数组（元素=迁移前该行 agent_kind）（存量值域不变性，FR-02；不合并不清理重复行，D-002）
  - 旧复合索引 ix_llm_providers_user_agent_default 已 drop，(user_id) 维度索引在位（R-01）
  - 执行 `alembic downgrade -1` 后再 `alembic upgrade head` 往返一致：agent_kind 恢复为 agent_kinds 首元素、复合索引恢复原形态（可回退）
  - backend/app/modules/llm_provider/model.py 无 agent_kind 单值列残留，列定义与索引和迁移终态一一对应
verify:
  - cd backend && alembic upgrade head
  - cd backend && alembic downgrade -1 && alembic upgrade head
  - grep -n "agent_kind" backend/app/modules/llm_provider/model.py（仅允许命中 agent_kinds）
constraints:
  - MUST NOT 改 sillyhub-daemon 仓任何代码（本变更全局红线：daemon 注入链零改动）
  - MUST NOT 合并或清理存量重复供应商行（D-002，用户手动删）；MUST NOT 留 agent_kind/agent_kinds 双列并存（规则 11 无历史兼容包袱）
  - 不新增测试用例（迁移升级测试含索引在位断言归 task-07）；本卡 verify 以 alembic 升降级往返为准，禁止跑全量测试（CLAUDE.md 规则 0）
  - backend/app/modules/llm_provider/model.py 与 task-02 共享（task-02 续改 schema/service）：按 depends_on 串行执行，本卡仅改列定义与索引，不动 DTO/服务逻辑
  - 迁移代码必须 Windows/Linux/macOS 三平台兼容（规则 13：纯 alembic op，无平台相关 shell 调用）
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
