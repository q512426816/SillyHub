---
schema_version: 1
doc_type: module-card
module_id: skill_source
author: qinyi
created_at: 2026-09-11 08:40:00
---

# git 技能源（skill_source）

## 定位

平台共享 git 技能源（`SkillSource`，admin CRUD）+ 用户启用绑定（`UserSkillEnable`）+
技能库三源聚合的后端（变更 2026-09-11-skills-central-library，D-002/D-003/D-006/D-007）。
git 技能本体**不进 DB**——浅克隆进缓存根 `<spec_data_root>/skills_git_cache/<source_id>/`，
文件系统为源；本模块负责拉取（git_fetcher）/发现（扫 SKILL.md 目录）/启用绑定，
「进 bundle」的收集在 agent/skills_bundle_service（第三源，经 `_gather_all_files` 并入）。

## 契约摘要

- `GET/POST /api/skill-sources`、`PATCH/DELETE /api/skill-sources/{source_id}`、
  `POST /api/skill-sources/{source_id}/refresh` —— 均 admin
  （`require_permission_any(Permission.SETTINGS_ADMIN)`，settings/router.py 同款）
- `GET /api/skills/library` → `LibraryView{sources[], skills[]}`（三源聚合 + 我的
  启用态；任意登录用户）
- `POST /api/skills/{skill_key}/enable`（body `EnableOp{enabled}`）/ `DELETE`（无体，
  等价 enabled=False）—— 本人（`get_current_user`，无 user_id 参数无代写面）
- `skill_key` 命名空间：git = `<source_id>:<目录名>`（**恒含冒号**，唯一可 enable 的
  来源）；sillyspec/custom = tar 顶层目录名（不含冒号，恒启用不可 enable）。冒号是
  RFC 3986 路径合法字符，路径参数原样可达，客户端 %-encoding（`%3A`）亦被 ASGI 解码
- 表 `skill_sources`（url String(500) UNIQUE / branch 默认 'main' / subdir NULL /
  enabled 默认 true / last_commit / last_fetched_at / last_error）+
  `user_skill_enables`（UNIQUE(user_id, skill_key)，user_id FK users CASCADE；
  **skill_key 刻意不做 FK**——删源时按前缀 `<source_id>:` 连带清绑定）

## 关键逻辑

```
写路径: create/update 改 url → await git_fetcher.assert_source_url（SSRF 首防线，
       委托 core/ssrf async assert_public_url——必须显式 await，漏 await 只建
       coroutine 等于没校验）→ probe_git_binary 缺 → GitBinaryMissing 422 →
       url 查重 409（commit 捕 IntegrityError 并发兜底同转 409）
保存即拉取: _trigger_fetch best-effort 永不抛（HTTP 仍 2xx）——成功回写
       last_commit/last_fetched_at 并清 last_error；失败只记 last_error
       （成功回写字段保留，区分「从未成功」与「上次成功这次失败」）
拉取: 缓存目录无 .git → clone --depth 1 --filter=blob:none --no-tags -b <branch>；
       有 → fetch --prune origin <branch> + reset --hard FETCH_HEAD（增量不重建，
       未跟踪文件保留）；GIT_TERMINAL_PROMPT=0 + 每步 300s 超时 +
       asyncio.create_subprocess_exec；失败半成品目录清掉可重 clone
发现: discover_skills 扫含 SKILL.md 目录（剪枝 .git）；单技能 >200 文件或
       >10MB 跳过 + log warn（D-007 二防线，不影响其它技能）；结果不落库
enable: parse_skill_key 格式非法 422 → enabled=True 须命中**启用源**的发现结果
       （源不存在/停用/目录消失统一 404 SkillNotDiscoverable）→ 绑定
       upsert/delete 幂等；停用不校验存在性（悬空语义归收集层）
bundle 第三源: agent/skills_bundle_service._collect_enabled_git_skills 收集启用绑定
       命中（悬空绑定验目录存在，不存在跳过但绑定保留——技能回来自动恢复）
```

## 注意事项

- **D-010 同名优先级是硬约束**：收集顺序即优先级 `sillyspec-* > CustomSkill >
  git 源（源间 source_id 升序）`，同名先到先得、后到跳过 + log warn——tar 扁平
  解压同名静默覆盖是实证坑（skill-manager），禁止打乱 `_gather_all_files` 拼接序
- **缓存根约定** `<spec_data_root>/skills_git_cache/<source_id>/`（固定名与
  spec_data_root 下 `{ws_id}` UUID 子目录不冲突）；跨平台一律 pathlib
- **file:// 测试手法**：本地 `git init` 假仓（skills/ 下 SKILL.md 目录）+
  `Path.as_uri()` 直达 `fetch_source`——SSRF 只在 create/update 改 url 时拦
  （fetcher 自身不拦：refresh/触发走缓存无须重复 DNS，也让本地 URL 可达测试）；
  真 git 用例统一 `requires_git` skipif 分流，无 git 环境只跑纯 fs/mock 用例
- **git tagOpt 坑（git 2.45 实测）**：`--no-tags` 只在 clone 传——它会持久化写
  `tagOpt = --no-tags` 进 `.git/config`，后续增量 `fetch --prune`（不重复传
  --no-tags）自动继承；测试断言该副作用时 git 写入的配置键大小写不定，比较前
  须 lower（test_git_fetcher.py `tagopt = --no-tags` 断言）
- SSRF await 坑：`assert_public_url` 是 async——漏 await 不报错只建 coroutine，
  等于没校验（plan-review 修正点，新调用点照抄 `await git_fetcher.assert_source_url`）
- 拉取失败永不阻塞保存请求；触发时机=保存源/刷新端点/启动后台三处，v1 无定时
  cron；`enabled=false` 源不参与发现与收集（library 也不展示其技能）
- frontend 消费口在 `frontend/src/components/skills-library/skill-source-api.ts`
  （客户端+hooks 共置组件目录，不进 lib/——task-04 卡约束）；skill_key 前端
  URL 构造一律 `encodeURIComponent`（含冒号 `%3A`）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
