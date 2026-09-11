---
id: task-01
title: 'workspace-scope enable migration, dual-scope toggle, and D-010 NULL predicates'
title_zh: '迁移（workspace_id 列+双 partial）+model ORM+toggle 双维度+D-010 四处谓词'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 21:39:17
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003@v1, D-010@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/skill_source/
  - backend/migrations/versions/
  - backend/app/modules/agent/skills_bundle_service.py
  - backend/app/modules/daemon/tests/test_skills_bundle.py
target_files:
  - backend/app/modules/skill_source/service.py
  - backend/app/modules/agent/skills_bundle_service.py
  - NEW:backend/migrations/versions/20260911220000_add_workspace_scope_enables.py
provides:
  - user_skill_enables 增 workspace_id 列与双 partial unique 迁移（D-003 单表双 scope）
  - toggle_enable 双 scope 签名（可选 workspace_id 参数，缺省 None 为 user 维度；library 与 enable 端点 HTTP 侧同名可选参数）
  - _collect_enabled_git_skills 并集签名与 build_skills_manifest/build_skills_bundle 的 workspace_id 透传（None 显式 IS NULL，非 None 并集谓词）
goal: >
  user_skill_enables 扩 workspace_id 列成单表双 scope，toggle/list_library 双维度化并修 D-010 四处 NULL 谓词，为后续四卡提供底座（FR-01）。
implementation:
  - 迁移与 model——新建 alembic revision（workspace_id 列 UUID NULL 外键 workspaces.id ondelete CASCADE；DROP 原 UNIQUE(user_id, skill_key) 改 partial（WHERE workspace_id IS NULL）并新增 partial unique(workspace_id, skill_key)）；model.py UserSkillEnable __table_args__ 改 Index(unique=True) 双 partial（postgresql_where 与 sqlite_where 双方言，model.py:92-94 锚点）
  - service.py 与 router.py——toggle_enable 增可选 workspace_id（删除谓词带 scope，user 维度只删 IS NULL 行、workspace 维度只删该 workspace 行，service.py:310-318 锚点；workspace 行 user_id 填操作者审计）；list_library 增 workspace 维度（enabled_keys 显式 IS NULL 过滤防 ws 行污染，service.py:360-368 锚点）；enable/library 端点透传可选参数，不传行为逐字不变
  - skills_bundle_service.py——_collect_enabled_git_skills 增可选 workspace_id（:182 签名）None 时显式 AND workspace_id IS NULL（无绑定 user bundle version hash 零变化）、非 None 并集谓词（D-002）；build_skills_manifest/build_skills_bundle 透传（:413 与 :422 锚点）
  - 测试——test_library_enable.py 补双维度 toggle（删除谓词互不误删/幂等）与 list_library 两维度过滤；test_skills_bundle.py 补无绑定 user bundle 逐字一致（version hash 显式断言）与并集直测
acceptance:
  - alembic upgrade/downgrade 干净（双 partial 双方言生效）
  - user 维度零回归（不传 workspace_id 时 list_library/toggle/bundle 输出逐字一致，version hash 显式断言）；双维度 toggle 互不干扰各有用例；传参时第三源并集含 user 与 workspace 两边启用（直测）
verify:
  - cd backend && uv run pytest app/modules/skill_source -q --no-cov
  - cd backend && uv run pytest app/modules/daemon/tests/test_skills_bundle.py -q --no-cov
constraints:
  - user 维度语义逐字不变是回归底线（D-010 四处谓词禁顺手重构；迁移 partial 索引双方言声明兼容三平台）
  - 本卡不做 adopt 与 MCP import（task-02/03 范围）；daemon 侧零改动（分发归 task-04）
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
