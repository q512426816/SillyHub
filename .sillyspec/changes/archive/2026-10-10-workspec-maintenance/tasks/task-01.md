---
id: task-01
title: 'backend 数据模型与迁移——`workspace_linked_repos` + `workspace_linked_repo_paths` 两表、唯一约束、级联（FR-01/FR-02）'
title_zh: 'backend 数据模型与迁移——`workspace_linked_repos` + `workspace_linked_repo_paths` 两表、唯一约束、级联（FR-01/FR-02）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 19:04:59
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-006@v1, D-007@v1]
allowed_paths:
  - backend/app/modules/workspace/linked_repos/model.py
  - backend/migrations/versions/20261010190000_create_workspace_linked_repos.py
target_files:
  - NEW:backend/app/modules/workspace/linked_repos/model.py
  - NEW:backend/app/modules/workspace/linked_repos/__init__.py
  - NEW:backend/app/modules/workspace/linked_repos/tests/__init__.py
  - NEW:backend/app/modules/workspace/linked_repos/tests/conftest.py
  - NEW:backend/migrations/versions/20261010190000_create_workspace_linked_repos.py
provides:
  db-schema:
    tables: [workspace_linked_repos, workspace_linked_repo_paths, workspace_linked_repo_sync_states]
    uniques: ["(workspace_id,name)", "(linked_repo_id,user_id)", "(linked_repo_id,machine_id,layer)"]
    cascade: "paths 与 sync_states 随 linked_repo 行删除级联清理"
goal: >
  建立「关联仓」三表数据模型与迁移（共享登记/成员级路径/落盘状态），为 CRUD API 与
  同步链路提供持久层（design.md 数据模型节 + 接口定义节表结构）。
implementation:
  - 新建 backend/app/modules/workspace/linked_repos/model.py：三张 SQLModel 表，继承
    backend/app/models/base.py:BaseModel（审计钩子）；无 relation_kind 字段（D-006）；
    workspace_linked_repo_paths 为成员级 (linked_repo_id,user_id) 唯一（D-007）；
    sync_states 字段 (linked_repo_id, machine_id, layer, status, detail, synced_at)
  - 新建迁移 backend/migrations/versions/20261010190000_create_workspace_linked_repos.py：
    建三表 + 三个唯一约束 + FK ondelete=CASCADE
acceptance:
  - alembic upgrade head 后三表存在，字段与 design.md 接口定义节表结构逐字段一致（无 relation_kind）
  - (workspace_id,name) 与 (linked_repo_id,user_id) 重复插入抛唯一约束冲突
  - 删除 linked_repo 行后 paths/sync_states 关联行级联消失
verify:
  - cd backend && uv run pytest app/modules/workspace/linked_repos/tests -q --no-cov
constraints:
  - 不动 backend/app/modules/workspace/model.py 的 Workspace 表（单仓约束保持现状）
  - 仅供数层：本 task 不写任何 router/service 逻辑
  - 禁跑全量 pytest（CLAUDE.md 规则 0），只跑本模块测试
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
