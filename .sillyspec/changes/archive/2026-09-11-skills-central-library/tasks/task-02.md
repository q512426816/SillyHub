---
id: task-02
title: 'git fetcher shallow clone and SKILL.md discovery with local fake repo tests'
title_zh: 'git_fetcher 拉取器——浅克隆/更新/技能发现（双上限+300s 超时+本地假仓测试）'
author: 'qinyi'
created_at: 2026-09-11 02:18:41
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-006, D-007]
allowed_paths:
  - backend/app/modules/skill_source/
target_files:
  - NEW:backend/app/modules/skill_source/git_fetcher.py
  - NEW:backend/app/modules/skill_source/tests/test_git_fetcher.py
SkillSource/UserSkillEnable 模型 + /api/skill-sources 源 CRUD + 缓存根路径约定
      needs: [SkillSource, skills_git_cache/<source_id>/ 缓存根约定]
provides:
  - contract: fetch_source/probe_git_binary/discover_skills 拉取与发现 API
    fields: [probe_git_binary, fetch_source, FetchResult(ok/commit/error), assert_source_url, discover_skills, DiscoveredSkill]
goal: >
  落地 design §接口定义 git_fetcher——probe_git_binary/fetch_source（clone --depth 1
  --filter=blob:none --no-tags、更新 fetch --prune+reset --hard、GIT_TERMINAL_PROMPT=0、
  300s 超时）/discover_skills（SKILL.md 目录扫描、≤200 文件、≤10MB、排除 .git），并接线
  task-01 create/refresh 保存即拉取（失败不阻塞），本地 git init 假仓真实 clone 测试。
implementation:
  - 'git_fetcher.py——async probe_git_binary（shutil.which+git --version 子进程确认）；assert_source_url 封装 await assert_public_url（SSRF 复用 core/ssrf.py，D-007 首防线）'
  - 'fetch_source(source, cache_root)——缓存目录空则 git clone --depth 1 --filter=blob:none --no-tags --branch 指定分支；已存在则 git fetch --prune origin 分支 + git reset --hard FETCH_HEAD；asyncio.create_subprocess_exec（先例 git_gateway/service.py）+ env 注入 GIT_TERMINAL_PROMPT=0（禁交互挂死）+ 单命令 300s 超时；返回 FetchResult(ok/commit/error)，commit 取 rev-parse HEAD'
  - 'discover_skills(cache_dir)——os.walk 扫含 SKILL.md 目录（剪枝 .git）；单技能 >200 文件或累计 >10MB 跳过该目录并 log warn（D-007 二防线，不抛异常）；DiscoveredSkill 含目录名/description（SKILL.md frontmatter 解析）/相对路径；subdir 非空时以缓存根下 subdir 为发现根'
  - 'service.py 接线——create_source/refresh_source 调 fetch_source+discover_skills，成功回写 last_commit/last_fetched_at 并清 last_error；失败记 last_error 不阻塞 create（design 保存即拉取失败不阻塞）；git 探测统一改走 probe_git_binary（替换 task-01 shutil.which 初判，422 语义不变）'
  - 'tests/test_git_fetcher.py——tmp_path 本地 git init 假仓（配 user.name/email，commit 含 skills/foo/SKILL.md 与超标目录）真实 clone/fetch 全链路；断言 FetchResult.ok+commit 非空、二次 fetch_source 走 fetch+reset 不重建目录、discover 命中/上限跳过/.git 排除；无 git 环境用例 skipif 分流探测 422 路径'
acceptance:
  - '假仓 clone 成功且命令含 --depth 1 --filter=blob:none --no-tags；二次调用走 fetch --prune+reset --hard 增量更新'
  - '双上限生效——>200 文件或 >10MB 目录跳过+log warn，不影响其它技能与主流程'
  - '子进程 env 含 GIT_TERMINAL_PROMPT=0 且 300s 超时；create/refresh 回写 last_commit/last_error 正确、拉取失败不阻塞 create（HTTP 仍 2xx）'
  - 'test_git_fetcher.py 全绿且 task-01 既有用例零回归'
verify:
  - 'cd backend && uv run pytest app/modules/skill_source/tests/test_git_fetcher.py -q --no-cov'
  - 'cd backend && uv run pytest app/modules/skill_source -q --no-cov（含 task-01 用例零回归）'
  - 'cd backend && uv run ruff check app/modules/skill_source && uv run mypy app/modules/skill_source'
constraints:
  - '只动 skill_source 模块内文件（git_fetcher 新建/service 接线/tests），不改 skills_bundle_service 与 daemon 侧'
  - '子进程一律 create_subprocess_exec+env 注入禁 shell=True；路径 pathlib，Windows/Linux/macOS 三平台可跑（CLAUDE.md 规则 13）'
  - '浅形态固定三参 --depth 1 --filter=blob:none --no-tags（D-006），不做全量镜像/fetch 深历史'
  - '测试只依赖本地 git init 假仓不访问外网（CI 无外网可跑）；不跑全量测试'
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
