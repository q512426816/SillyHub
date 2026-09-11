---
id: task-01
title: 'skill_source module foundation - two-table model, migration and admin-gated source CRUD'
title_zh: 'skill_source 模块——skill_sources/user_skill_enables 两表模型+迁移+源 CRUD（admin 门+SSRF+git 探测 422）'
author: 'qinyi'
created_at: 2026-09-11 02:18:41
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-002, D-007]
allowed_paths:
  - backend/app/modules/skill_source/
  - backend/migrations/versions/
  - backend/app/main.py
target_files:
  - NEW:backend/app/modules/skill_source/model.py
  - NEW:backend/app/modules/skill_source/schema.py
  - NEW:backend/app/modules/skill_source/service.py
  - NEW:backend/app/modules/skill_source/router.py
  - NEW:backend/app/modules/skill_source/tests/test_source_crud.py
  - backend/app/main.py
provides:
  - contract: SkillSource/UserSkillEnable 模型 + /api/skill-sources 源 CRUD + 缓存根路径约定
    fields: [SkillSource, UserSkillEnable, SourceCreate, SourceUpdate, SourceRead, skills_git_cache/<source_id>/ 缓存根约定, skill_key 编码 <source_id>:<目录名>]
goal: >
  建 skill_source 新模块地基——skill_sources 与 user_skill_enables 两表（alembic 迁移，
  down_revision 对齐实测 head b299f3782f7a）+ /api/skill-sources admin CRUD
  （SETTINGS_ADMIN 门 + SSRF async 校验 + git 二进制探测 422）+ main.py 注册，
  为 task-02 拉取器与 task-03 绑定/收集提供模型与端点契约（design §接口定义/§数据模型）。
implementation:
  - 'model.py 照 skills/model.py 先例（BaseModel+sqlmodel Field+sa_column）建两表，字段逐字对照 design §数据模型——skill_sources(id UUID PK/url String(500) UNIQUE/branch String(100) 默认 main/subdir String(200) NULL/enabled bool 默认 true/last_commit String(40) NULL/last_fetched_at NULL/last_error Text NULL/created_at/updated_at) 与 user_skill_enables(id UUID PK/user_id FK users CASCADE/skill_key String(200)/user_id 与 skill_key 联合 UNIQUE/created_at)'
  - 'alembic 迁移两表——down_revision 对齐执行时实测 head（当前实测 b299f3782f7a；若并行双 head 先 merge 再挂，R-03），upgrade/downgrade 正反向可执行'
  - 'schema.py 建 SourceCreate/SourceUpdate/SourceRead（Read 含 last_commit/last_fetched_at/last_error/enabled，照 skills/schema.py 先例）；service.py SkillSourceService 源 CRUD——create/update 前显式 await assert_public_url(url)（core/ssrf.py:34-53 为 async，plan-review 修正禁漏 await；私网/非法 scheme 即 400），delete_source 连带清理该源 user_skill_enables（skill_key 前缀匹配）与缓存目录（best-effort 目录可不存在）'
  - 'git 二进制探测——create/refresh 前探测（本卡 shutil.which 初判，task-02 probe_git_binary 统一后替换接线），不可用即 422 明确提示（R-01/兼容策略）；本卡不做真实 clone/fetch，last_commit/last_error 字段先备好'
  - 'router.py 五端点 GET/POST(201)/PATCH/DELETE(204)/POST refresh 于 /api/skill-sources，权限 require_permission_any(Permission.SETTINGS_ADMIN)（auth_deps+auth.permissions 先例 settings/router.py）；main.py import+include_router(skill_source_router, prefix="/api") 照 :903-904 skills_router 注册先例'
  - 'tests——两表约束（url UNIQUE/联合唯一）+ CRUD 权限矩阵（非 admin 403、admin 全通、SSRF 拒 127.0.0.1 与非法 scheme 得 400、monkeypatch 探测 False 得 422）'
acceptance:
  - '迁移单 head 且 upgrade head 后两表结构与 design §数据模型一致、downgrade 干净'
  - '五端点 admin 全通、非 admin 403；SSRF 拒私网/非法 scheme（400）；git 缺失环境创建/刷新 422（R-01）'
  - 'app/modules/skill_source 测试全绿；main.py 注册后 openapi 含 skill-sources 端点'
verify:
  - 'cd backend && uv run alembic heads && uv run alembic upgrade head'
  - 'cd backend && uv run pytest app/modules/skill_source -q --no-cov'
  - 'cd backend && uv run ruff check app/modules/skill_source app/main.py && uv run mypy app/modules/skill_source'
constraints:
  - 'assert_public_url 是 async——service 内必须显式 await（漏 await 只建 coroutine 不校验，plan-review 修正点）'
  - 'user_skill_enables 本卡只建模型+迁移，enable 端点归 task-03；clone/fetch/发现归 task-02'
  - '迁移 down_revision 以执行时实测 head 为准（b299f3782f7a 为 2026-09-10 实测），禁止盲写；双 head 先 merge'
  - '跨平台兼容——路径 pathlib、git 探测 shutil.which 不硬编码（CLAUDE.md 规则 13）；不跑全量测试'
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
