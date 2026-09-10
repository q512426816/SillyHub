---
author: qinyi
created_at: 2026-09-11 02:02:06
scale: large
---

# 设计文档（Design）— 2026-09-11-skills-central-library

<!-- 由 sillyspec design-init 生成的骨架（2026-09-11-skills-central-library）——逐节填散文后删除本注释；存量手写路径不受影响 -->

## 背景

平台技能链现状（skills_bundle_service.py）：sillyspec-* 平台内置扫描 + CustomSkill 用户 DB → manifest（content-hash 版本）+ tar.gz → daemon 同步到 .claude/skills/。对照 ai-toolbox 调研（docs/research-ai-toolbox-config-management-2026-09-10.md §4）：缺 git 技能源、按用户启用绑定、存量散技能收编。配套方案 proposal §5（P1）。version hash 机制已与 ai-toolbox content_hash 等价（D-005 复用）。

## 设计目标

1. git 技能源（admin 配置，浅克隆进缓存根，全员可见）——D-002/D-006/D-007
2. user 启用绑定（git 技能默认关，用户逐个启用进 bundle）——D-003
3. ~~workspace 收编~~ v1 砍（Grill B-1：扫描根 backend 不可达，D-011）——git 源+手动建已覆盖入库路径
4. 零回归三保证：sillyspec-*/CustomSkill 行为逐字不变；未启用 git 技能零入 bundle

## 非目标

- 不做用户私有 git 源（SSRF/审查/配额体量，v2）
- 不做 symlink 分发/技能市场 UI/跨用户分享（proposal §5.3）
- 不做定时 cron 拉取（启动+手动+保存时三触发够用）
- 不改 daemon 侧（manifest 协议零变化，git 技能自动随现有链路分发）
- git 技能本体不进 DB（缓存根文件系统为源）

## 拆分判断

单一连贯变更：源管理/拉取/绑定/收集扩展共享 bundle 组装同一事实源，拆开中间态（表建了没收集=绑定无效）。Wave 按「模型+源管理 → 拉取器 → 绑定+收集 → 前端」切，共享文件串行。

## 总体方案

（八段设计见 decisions D-008/D-009 与对话展示，架构图从简）

```
skill_source 模块（新）                skills_bundle_service（扩展第三源）
├─ SkillSource 表（admin CRUD）         _gather_all_files（真正合并点 :250-264）:
├─ git 拉取器（subprocess+SSRF+上限）     ├─ sillyspec-*（不动）
├─ 缓存根 skills_git_cache/<src_id>/      ├─ CustomSkill（不动）
└─ 技能发现（扫 SKILL.md 目录）           └─ user_skill_enables 命中的缓存技能（新）
user_skill_enables 表（新）            （收编砍 D-011）
```

**Wave**：W1 模型+迁移+源 CRUD；W2 git 拉取器+技能发现；W3 绑定表+library 端点+collect 第三源（含 D-010 同名优先级去重）；W4 前端技能页（源管理+技能库启用）+gen:types。收编砍（D-011）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:backend/app/modules/skill_source/__init__.py | 新模块包 |
| 新增 | NEW:backend/app/modules/skill_source/model.py | skill_sources + user_skill_enables 两表 |
| 新增 | NEW:backend/app/modules/skill_source/schema.py | 源 CRUD/库列表 DTO |
| 新增 | NEW:backend/app/modules/skill_source/service.py | 源 CRUD+发现+启用绑定逻辑 |
| 新增 | NEW:backend/app/modules/skill_source/git_fetcher.py | subprocess git 浅克隆/更新/探测（D-006/D-007） |
| 新增 | NEW:backend/app/modules/skill_source/router.py | /api/skill-sources* + /api/skills/{key}/enable + library |
| 新增 | NEW:backend/app/modules/skill_source/tests/ | 模型/CRUD 权限/拉取器（本地 git init 假仓）/发现上限/收集第三源/同名优先级矩阵 |
| 新增 | NEW:backend/migrations/versions/xxxx_add_skill_source_tables.py | 两表迁移（down_revision 对齐执行时 head，注意并行双 head 先 merge） |
| 修改 | backend/app/modules/agent/skills_bundle_service.py | _collect 增第三源（启用绑定命中收集）+ manifest source 标记 |
| 修改 | backend/app/modules/daemon/tests/test_skills_bundle.py | 第三源/零回归用例（version 现状断言 :92-99/CustomSkill 合并 :194-275/version 锁定 :298-319 既有基地——plan-review 修正定位） |
| 修改 | backend/app/main.py | router 注册 |
| 修改 | frontend/src/app/(dashboard)/settings/skills/page.tsx | 升级两新区块（源管理 admin 卡/技能库启用开关；我的技能现状不动） |
| 新增 | NEW:frontend/src/components/skills-library/（按现有目录惯例） | 源卡/技能列表组件 |
| 修改 | frontend/src/lib/api-types.ts | gen:types |
| 修改 | backend/openapi.json | gen:types 联动 |
| 新增 | NEW:.sillyspec/docs/backend/modules/skill_source.md | 模块卡（收尾） |

## 接口定义

```python
# git_fetcher.py
async def probe_git_binary() -> bool
async def fetch_source(source: SkillSource, cache_root: Path) -> FetchResult
  # FetchResult{ok, commit, error}；clone --depth 1 --filter=blob:none --no-tags
  # 更新 fetch --prune + reset --hard；GIT_TERMINAL_PROMPT=0/300s/spawn_blocking 或 create_subprocess
def assert_source_url(url: str)  # assert_public_url 复用（SSRF）
def discover_skills(cache_dir: Path) -> list[DiscoveredSkill]
  # 扫含 SKILL.md 目录；≤200 文件/≤10MB 上限；排除 .git

# service.py 核心
class SkillSourceService:
    async def create_source(url, branch, subdir, user) -> SourceRead   # admin；SSRF+保存即拉取(失败不阻塞)
    async def refresh_source(id, user) -> SourceRead                    # admin
    async def list_library(user) -> LibraryView                          # 三源聚合+我的启用态
    async def toggle_enable(skill_key, user, enabled)                    # 本人
# 第三源（skills_bundle_service 扩展；经 _gather_all_files :250-264 并入——plan-review 修正点名）
async def _collect_enabled_git_skills(session, user_id) -> list[tuple[Path, bytes]]
  # user_skill_enables 命中 → 缓存根目录文件集（排除 .git）
```

REST：`GET/POST /api/skill-sources`、`PATCH/DELETE /api/skill-sources/{id}`、`POST /api/skill-sources/{id}/refresh`（均 admin）；`GET /api/skills/library`、`POST/DELETE /api/skills/{skill_key}/enable`（本人）。收编端点不做（D-011：扫描根 backend 不可达）。

**rel_path 与同名去重（D-010）**：git 技能进 tar 的 rel_path=缓存根内目录名原样（与 CustomSkill 的 <name>/SKILL.md 同层）；收集顺序 sillyspec-* → CustomSkill → git 源（source_id 升序），同名先到先得、后到跳过+log warn（skill-manager 扁平解压实证同名会静默覆盖——Grill B-2）。

## 生命周期契约表

不涉及 lifecycle 实体（无 session/lease/claim 状态迁移；git 拉取为无状态子进程操作+缓存目录生命周期随源删除清理）。豁免。

## 数据模型

```text
skill_sources
  id UUID PK / url String(500) UNIQUE / branch String(100) 默认 'main'
  subdir String(200) NULL / enabled bool 默认 true
  last_commit String(40) NULL / last_fetched_at NULL / last_error Text NULL
  created_at / updated_at
user_skill_enables
  id UUID PK / user_id FK users CASCADE / skill_key String(200)
  UNIQUE(user_id, skill_key) / created_at
  -- skill_key = "<source_id>:<技能目录名>"（源删除级联清理绑定：service 层删源时连带）
```

## 兼容策略（brownfield 必填）

- 三零回归（测试锁定）：无源/无绑定时 bundle 的 version hash 与现状一致断言（tar 字节含 gzip mtime 不逐字节比——Grill 修正）；sillyspec-* 与 CustomSkill 用例原样通过
- daemon 零改动：manifest 协议向后兼容（items 增可选 source 字段——Grill 实证 skill-manager 只消费 version/sha256 不逐字段读）
- 源删除：缓存目录与绑定连带清理（技能从用户 bundle 消失=version 变化=daemon 重拉，链路自洽）；刷新后技能目录消失的悬空绑定：收集时命中即验目录存在，不存在跳过（绑定保留——技能回来自动恢复）
- git 不可用环境：源保存报 422 明确提示；既有两源不受影响

## 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | 部署容器缺 git 二进制 | P1 | probe 探测+422 明确报错+部署文档注明（deploy compose 镜像确认） |
| R-02 | 恶意/超大仓库 | P1 | SSRF 断言+admin 门+文件数/字节双上限+子进程超时（D-007 三防线） |
| R-03 | 并行变更再造成 alembic 双 head | P2 | 迁移 down_revision 对齐执行时实测 head；如双 head 先 merge（b299f3782f7a 先例） |
| R-04 | skill_key 与 CustomSkill.name 撞名 | P2 | bundle 收集按 source 标记共存不互斥；前端展示区分；CustomSkill 保留前缀禁 sillyspec- 现状不变 |
| R-05 | git 缓存根目录遍历 IO（多源多技能） | P2 | 发现/收集仅遍历启用命中的目录；缓存根按源分子目录隔离 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001 范围 | 目标/非目标 | 已覆盖 |
| D-002 平台共享源 | 目标 1/数据模型 | 已覆盖 |
| D-003 默认关启用 | 目标 2/兼容策略 | 已覆盖 |
| D-004 收编 | superseded（D-011 v1 砍，扫描根不可达） | 已覆盖（撤销留痕） |
| D-010 rel_path/同名去重 | 接口定义/兼容策略 | 已覆盖 |
| D-011 收编撤销 | 非目标/接口定义 | 已覆盖 |
| D-005 版本复用 | 背景/总体方案 | 已覆盖 |
| D-006 subprocess git | 接口定义 git_fetcher | 已覆盖 |
| D-007 安全三防线 | 接口定义/R-02 | 已覆盖 |
| D-008 方案A | 总体方案 | 已覆盖 |
| D-009 设计确认 | 本文档 | 已覆盖 |

## 自审

- [x] 章节齐全 / frontmatter（scale=large）/ D-001~D-009 全覆盖 / 生命周期豁免 / 原型跳过（管理页扩展 D-009）/ 无存疑遗留
