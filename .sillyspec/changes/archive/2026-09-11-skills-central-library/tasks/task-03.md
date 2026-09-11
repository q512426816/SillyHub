---
id: task-03
title: 'user skill enable binding, library endpoints and bundle third source with name dedup'
title_zh: 'user_skill_enables 启用端点+技能库聚合+bundle 第三源（D-010 同名优先级+三零回归）'
author: 'qinyi'
created_at: 2026-09-11 02:18:41
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-003, D-005, D-010]
allowed_paths:
  - backend/app/modules/skill_source/
  - backend/app/modules/agent/skills_bundle_service.py
  - backend/app/modules/daemon/tests/test_skills_bundle.py
target_files:
  - NEW:backend/app/modules/skill_source/tests/test_library_enable.py
  - backend/app/modules/agent/skills_bundle_service.py
  - backend/app/modules/daemon/tests/test_skills_bundle.py
SkillSource/UserSkillEnable 模型 + /api/skill-sources 源 CRUD + 缓存根路径约定
      needs: [UserSkillEnable, skill_key 编码 <source_id>:<目录名>]
fetch_source/probe_git_binary/discover_skills 拉取与发现 API
      needs: [discover_skills, DiscoveredSkill]
provides:
  - contract: library/enable 端点 + bundle 第三源收集
    fields: [GET /api/skills/library LibraryView, 'POST+DELETE /api/skills/{skill_key}/enable 本人写', _collect_enabled_git_skills, manifest files 增可选 source 标记]
goal: >
  打通「用户逐个启用 git 技能进 bundle」全链路——enable 端点（本人）+ library 三源聚合
  （含我的启用态）+ skills_bundle_service._gather_all_files（:250-264 真正合并点，
  plan-review 修正）插入第三源 _collect_enabled_git_skills（D-010 同名优先级
  sillyspec-* 先于 CustomSkill 先于 git 源 source_id 升序，后到跳过 warn）+ manifest
  source 标记，test_skills_bundle.py 扩三零回归与同名矩阵。
implementation:
  - 'service.py——toggle_enable(skill_key, user, enabled) 本人写 user_skill_enables（skill_key 须命中启用源的 discover_skills 结果）；list_library(user) 三源聚合+我的启用态（git 技能默认关 D-003）；schema.py 增 LibraryView/LibrarySkill；router.py 增 GET /api/skills/library（登录即可）与 POST/DELETE /api/skills/{skill_key}/enable（本人，get_current_user 先例 skills/router.py）'
  - 'skills_bundle_service.py——_gather_all_files（:250-264）追加第三源（plan-review 修正点名，不动 _collect_skill_files/_collect_custom_skills 单体）；新 async _collect_enabled_git_skills(session, user_id)——查 user_skill_enables 命中且源 enabled 的 skill_key，映射缓存根 skills_git_cache/<source_id>/<目录>，目录不存在跳过（悬空绑定保留，技能回来自动恢复）、收集排除 .git；session 或 user_id 为 None 跳过（向后兼容纯代码库路径）'
  - 'D-010 同名去重——收集顺序 sillyspec-* 到 CustomSkill 到 git 源（source_id 升序），rel_path 顶层目录撞名先到先得、后到跳过+log warn（skill-manager 扁平解压同名静默覆盖实证，Grill B-2）；manifest files 条目增可选 source（sillyspec/custom/git），daemon 只消费 version/sha256 向后兼容'
  - 'test_skills_bundle.py 扩展（既有基地 version 断言 :92-99/CustomSkill 合并 :194-275/version 锁定 :298-319）——三零回归（无源无绑定 version hash 与现状一致；sillyspec-*/CustomSkill 既有用例原样绿；未启用 git 技能零入 tar 与 manifest）+ 启用后入 bundle/version 变化/source=git 标记 + 同名优先级矩阵（三源两两撞名+git 源间 source_id 序，后到跳过）'
  - 'skill_source tests 增 test_library_enable.py——enable 建/删幂等、library 三源聚合+启用态、悬空绑定跳过、非法 skill_key 格式 422、源删除后绑定与缓存连带清理（task-01 delete 路径联动）'
acceptance:
  - 'enable 端点——POST/DELETE 本人绑定幂等；library 返回三源聚合+启用态，git 技能默认未启用（D-003）'
  - '三零回归——无源无绑定 version hash 与现状一致；sillyspec-*/CustomSkill 既有用例原样通过；未启用 git 技能零入 bundle'
  - '同名矩阵——sillyspec-* 先于 CustomSkill 先于 git 源、git 源间 source_id 升序，后到跳过+log warn，tar 内顶层目录唯一；启用命中后文件全集（排除 .git）入 tar、version 变化、source=git；悬空绑定跳过且绑定行保留'
  - 'daemon 零改动——sillyhub-daemon 无 diff；_compute_version 算法不动（D-005 版本复用）'
verify:
  - 'cd backend && uv run pytest app/modules/skill_source app/modules/daemon/tests/test_skills_bundle.py -q --no-cov（plan 全局验收 1 同款命令）'
  - 'cd backend && uv run ruff check app/modules/skill_source app/modules/agent/skills_bundle_service.py && uv run mypy app/modules/skill_source app/modules/agent/skills_bundle_service.py'
  - 'git diff --name-only -- sillyhub-daemon/（为空即 daemon 零改动）'
constraints:
  - '_gather_all_files（:250-264）为唯一插入点（plan-review 修正非 _collect_skill_files）；session=None 纯代码库输出与现状逐字一致'
  - '回归断言用 version hash+tar 成员集合，不逐字节比 tar（gzip mtime，Grill 修正）；既有用例断言禁改（CLAUDE.md 规则 9），新用例只追加'
  - 'enable 仅本人可写（无 admin 代写）；manifest 只增可选 source 字段，version/files/sha256 语义与字段名不动（daemon 零改动前提）'
  - 'git 技能本体不进 DB（缓存根文件系统为源，design 非目标）；不跑全量测试'
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
