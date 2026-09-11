---
author: qinyi
created_at: 2026-09-11 02:11:51
---

# Decisions — 技能库（git 源 + 启用绑定 + 收编）

- id: D-001
  type: boundary
  priority: P0
  status: accepted
  source: user
  question: 范围（proposal §5 三层能力取舍）
  answer: 全做 v1：git 技能源（浅克隆）/ user 启用绑定 / workspace 收编；不做 symlink 分发/技能市场 UI/跨用户分享（proposal §5.3）。AskUserQuestion 未应答，按 proposal 推荐由主代理裁决，design 确认步用户可否决。
  normalized_requirement: SkillSource（git）+ user_skill_enable 绑定 + onboarding 收编进 v1；分发继续 tar.gz copy。
  impacts: [FR-1, FR-2, FR-3]
  evidence: docs/proposal-config-management-capability-2026-09-10.md §5

- id: D-002
  type: architecture
  priority: P0
  status: accepted
  source: user
  question: git 源作用域
  answer: 平台共享 git 源（admin 配置仓 URL+分支+可选子目录，服务端浅克隆进平台技能根，全员可见）；用户私有内容继续走 CustomSkill（含收编产物）。用户私有 git 源不做（SSRF/恶意仓审查/克隆配额体量大，留 v2）。
  normalized_requirement: SkillSource 表 admin CRUD；克隆目录挂平台技能根旁；不接用户提交的任意 URL。
  impacts: [FR-1]
  evidence: 主代理裁决（AskUserQuestion 未应答，推荐项）；安全考量

- id: D-003
  type: architecture
  priority: P0
  status: accepted
  source: user
  question: git 源技能默认启用状态
  answer: 默认关：git 源技能进库不进 bundle，用户在设置页逐个启用（user_skill_enable 绑定表，user×skill 唯一）；sillyspec-* 平台内置保持现状全员默认启（零回归）；CustomSkill 保持建了即启（归属者本人 bundle）。
  normalized_requirement: bundle 组装=sillyspec-*（现状）∪ 启用绑定命中的 git 源技能 ∪ 归属者 CustomSkill；未启用 git 技能零出现在任何 bundle。
  impacts: [FR-2]
  evidence: 主代理裁决（推荐项）；bundle 体积/质量把关考量

- id: D-004
  type: architecture
  priority: P0
  status: superseded
  source: user
  question: 收编（onboarding）范围与产物
  answer: 扫各 workspace .claude/skills/ 差集（排除平台库已有名与 sillyspec-* 前缀），列表供勾选，一键收编为该用户的 CustomSkill（content 存 DB；SKILL.md 原文含 frontmatter 则原样、缺则拼装——对齐 bundle 层防双拼逻辑）。同名不同内容跨 workspace → 冲突标记分组（ai-toolbox onboarding 同款）。
  normalized_requirement: 只读扫描+确认落库两阶段；收编不删源文件（用户自己清）；admin 可选收编为平台 sillyspec 风格？否——平台技能仍是代码库 sillyspec-* 目录（部署物），收编产物一律 CustomSkill（admin 若要平台化走 PR）。
  impacts: [FR-3]
  evidence: 主代理裁决；ai-toolbox onboarding.rs 参照
  【superseded by D-011：Grill 实证扫描根 backend 不可达，v1 砍收编】

- id: D-010
  type: definition
  priority: P0
  status: accepted
  source: design-grill
  question: git 技能 bundle 内 rel_path 与同名冲突（Grill B-2：tar 扁平解压同名静默覆盖）
  answer: rel_path=缓存根内技能目录名原样（与 CustomSkill 的 <name>/SKILL.md 同层）；收集期确定性去重：优先级 sillyspec-* > CustomSkill > git 源（多源间按 source_id 升序），低优先级同名条目跳过+log warn（技能名冲突不炸 bundle）；skill_key 仅 DB 绑定键不进 tar。
  normalized_requirement: 同名优先级与跳过日志有单测（三源两两撞名矩阵）。
  impacts: [FR-2]
  evidence: Grill B-2（skill-manager.ts:196-210/285-299 扁平解压实证）

- id: D-011
  type: boundary
  priority: P0
  status: accepted
  source: design-grill
  question: 收编（onboarding）可行性（Grill B-1：扫描根 backend 不可达）
  answer: v1 砍收编：实机实证散技能真身在 worktree/项目仓 .claude/skills（daemon 宿主侧，backend 容器不可直读——skill-manager.ts:1-13 路径互不可达头注）；spec workspace 实机无 .claude/skills（唯一后端先例 skills_view_service 只认 <spec_root>/skills）。做收编需 daemon RPC 扫描通道=改 daemon（本变更非目标自堵）。后续变更若做：daemon 侧扫描端点+backend 聚合。
  normalized_requirement: 本变更不含 scan/adopt 端点与前端收编入口；design 收编节改不做+理由。
  impacts: [范围]
  evidence: Grill B-1（workspace/skills_view_service.py:260-267 实机抽样+skill-manager.ts:1-13,481）

- id: D-005
  type: architecture
  priority: P0
  status: accepted
  source: code
  question: 版本感知复用现状吗
  answer: 复用：_compute_version（cumulative SHA-256 相对路径+内容）已等价 ai-toolbox content_hash；git 源技能文件并入 collect 后 version 自然感知变化；git 源额外记录 last_commit（展示用，不进 version 计算——内容 hash 已覆盖）。
  normalized_requirement: 不新增版本机制；manifest version 单一来源不变。
  impacts: [FR-1]
  evidence: backend/app/modules/agent/skills_bundle_service.py:149-168

- id: D-006
  type: architecture
  priority: P1
  status: accepted
  source: code
  question: git 拉取机制（服务端实现形态）
  answer: 不引入 GitPython 类重依赖，用 asyncio.create_subprocess_exec 调系统 git（deploy 容器已有 git——daemon 侧 git_* 模块先例）；--depth 1 --filter=blob:none --no-tags + GIT_TERMINAL_PROMPT=0 + 300s 超时 + 缓存目录（二次 fetch --prune + reset --hard）；触发=保存源时同步拉取一次 + 手动刷新端点 + 启动后台拉取（定时 cron 不做 v1——启动+手动够用，省调度器）。
  normalized_requirement: git 二进制可用性启动探测（缺 git → 源保存时报明确错误）；拉取失败不阻塞保存（标记 last_error）。
  impacts: [FR-1]
  evidence: ai-toolbox git_fetcher.rs 参数集；sillyhub-daemon git 模块先例

- id: D-007
  type: boundary
  priority: P0
  status: accepted
  source: code
  question: 安全边界（服务端 git 克隆）
  answer: 仅 admin 可配源（权限门）；URL 校验 https/http(s) scheme + 拒绝 localhost/私网段（复用 core/ssrf assert_public_url 先例）；克隆进独立缓存根（skills_git_cache），bundle 只读引用其下 SKILL 目录；仓库大小/文件数上限（防 zip 炸弹式仓库：单技能目录文件数 ≤200、总字节 ≤10MB，超限跳过+警告）。
  normalized_requirement: SSRF 断言+admin 门+大小/数量三重防线各有测试。
  impacts: [FR-1]
  evidence: core/ssrf.py 既有；ai-toolbox 上限思路

- id: D-008
  type: architecture
  priority: P0
  status: accepted
  source: user
  question: 实现方案（git 技能进 bundle 的路径）
  answer: 方案A「bundle 组装层扩展」：新 backend 模块 skill_source（源 CRUD+git 拉取+缓存根管理）+ user_skill_enable 绑定表；_collect_skill_files 增第三源（git 缓存根下按启用绑定过滤收集），sillyspec-*/CustomSkill 收集逻辑零改动；收编=独立扫描端点。否决 B（克隆产物写 DB 行——失去 git 更新语义/污染 CustomSkill 语义/每次更新全量重写行）与 C（daemon 侧拉 git——执行器错位承担内容源职责）。
  normalized_requirement: bundle 三源=sillyspec-*（现状）∪ CustomSkill（现状）∪ 启用绑定的 git 缓存技能（新增过滤收集）；skill_source 模块独立成卡。
  impacts: [FR-1, FR-2]
  evidence: 主代理裁决（方案对比在案）

- id: D-009
  type: architecture
  priority: P0
  status: accepted
  source: user
  question: 整体设计确认
  answer: 用户未应答，按推荐继续（可否决窗口=本轮汇报）：bundle 三源零改动两源/3 新表（skill_sources+user_skill_enables）/subprocess git+SSRF 三防线/collect 最小侵入第三段/收编两阶段写 CustomSkill/技能页三段式/零回归三保证。原型跳过（管理页扩展无新页面）。
  normalized_requirement: design.md 按八段落盘。
  impacts: [全 FR]
  evidence: 设计分段展示在案（对话输出）
