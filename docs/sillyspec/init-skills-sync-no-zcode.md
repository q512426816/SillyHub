---
title: sillyspec init 技能同步不含 zcode——detectTools 无检测分支 + skillToolDirs 无映射条目（双层缺口）
date: 2026-10-08
status: 活跃（工具缺陷待修；守则可先行）
source: 2026-10-08-sync-sillyspec-skills-3320 活体——平台预置技能缺 sillyspec-flow，排查发现 CLI 升级后 .zcode/skills 静默失配
---

# init 技能同步不含 zcode（双层缺口）× 本仓 .gitignore 整目录忽略的复合坑

> 一句话守则：**CLI 升级刷新内嵌技能时，`sillyspec init` 之后再跑一次
> `sillyspec init --tool zcode`（拿命令卡），并手动把 npm 包内
> `.claude/skills/sillyspec-*` 补拷到 `.zcode/skills/`，提交记得 `git add -f .zcode/`。**

## 缺口一：detectTools 没有 zcode 分支（自动发现失灵）

- `detectTools`（sillyspec `src/init.js:273-284`）只检测 `.claude`/`.cursor`/
  `.openclaw`/`AGENTS.md`/`GEMINI.md`/`INSTRUCTIONS.md` 六个信号，
  **没有 `.zcode` 目录检测**——即使项目里 `.zcode/skills/` 已存在，
  zcode 也永远不会进入 tools 列表。
- 后果：AGENTS.md 注入、命令卡、技能复制三面全部跳过 zcode。

## 缺口二：skillToolDirs 无 zcode 条目（显式指定也拿不到技能）

- 即使 `sillyspec init --tool zcode` 显式指定，`skillToolDirs`
  （`src/init.js:478-483`）只有 claude/codex/openclaw/opencode 四条映射，
  技能**仍不会**同步到 `.zcode/skills/`——只有命令卡会落
  `.zcode/commands/sillyspec/`（2026-10-08 实测：8 张卡生成、0 个技能同步）。
- 讽刺点：zcode 在 `VALID_TOOLS` 里，命令卡工具面注释还写着
  「仅 zcode/claude 有落点（D-003）」——唯独技能复制这层漏了。

## 复合坑（本仓特有）：.gitignore 整目录忽略 `.zcode/`

- 本仓 `.gitignore:5` 是 `.zcode/`——历史文件已跟踪所以存活，但**新增**
  技能文件（如 `sillyspec-flow/`）不进 `git status`、正常 `git add` 会跳过，
  不 `add -f` 就静默丢提交，下次 clone 直接缺技能。
- 守则：`.zcode/` 下新增文件一律 `git add -f`（本次变更已实操验证）。

## 实测损失（不修会怎样）

- 平台技能链 `.claude/skills → docker 镜像 → 后端 bundle → daemon` 以
  仓库文件为源，CLI 升级后若只跑 init：四镜像目录里 .zcode 缺新技能；
  会话可用技能列表（ZCode 读 `.zcode/skills/`）与 CLAUDE.md/AGENTS.md
  引导的协议脱节（本次：规则 4 已引导 flow 协议、技能列表却无
  `sillyspec:flow`）。

## 工具侧修复建议（上游 sillyspec）

1. `detectTools` 增加 `if (existsSync(join(projectDir, '.zcode'))) found.push('zcode');`
2. `skillToolDirs` 增加 `zcode: '.zcode/skills'`；
3. （可选）`--tool zcode` 输出里明示「技能同步 0 个」的原因，而不是只打印
   其它工具的「✓ 已同步 (N 个)」让用户误以为全覆盖。

## 关联

- 上游命令卡已支持 zcode 落点（2026-09-21-flow-command-cards D-003），
  本坑只是技能复制面；CLAUDE.md 规则 4 的 thin 协议引导依赖
  `sillyspec-flow` 技能存在，两缺口叠加时引导与技能脱节最明显。
