---
author: flow-machine-draft
created_at: 2026-10-08T01:59:18.923Z
---
# 设计记录（Design Record）— 2026-10-08-sync-sillyspec-skills-3320

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

仓库内嵌 sillyspec 技能快照落后最新 CLI（3.32.0）：缺新增的 `sillyspec-flow`（21st 技能），`.zcode/sillyspec-quick` 被本地手补分叉，AGENTS.md 注入段停在 v3.29.3。平台预置技能链（`.claude/skills` → docker build `additional_contexts` → `/app/sillyspec-skills` → 后端 `SKILLS_GLOB` 打 bundle → daemon 软链进 worktree）以仓库文件为唯一源，故修复=刷新仓库快照。

方案：主仓库根目录跑 `sillyspec init`（历史惯例，见 commit 904ef623e v3.28.3 刷新）同步 `.claude/.codex/.opencode` 三目录 + 刷新 AGENTS.md 注入段；`.zcode/skills` 因 CLI 已知缺口（detectTools 无 zcode 分支 + skillToolDirs 无映射）手动补拷 `sillyspec-flow` 并用上游原版覆盖手补过的 `sillyspec-quick`；`sillyspec init --tool zcode` 补齐 `.zcode/commands/sillyspec/` 流程命令卡；缺口本身记入 `docs/sillyspec/` 活跃坑。同步源取 npm `sillyspec@3.32.0` tgz 解包件（已验证与本地全局 CLI 开发仓逐字节一致，21 技能）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无代码接口变化。变更面全部为静态文件：四个工具目录的 `sillyspec-*` 技能文件、`AGENTS.md` 注入段、`.claude` 与 `.zcode` 的流程命令卡（新增 8 张 ×2）、`docs/sillyspec/` 新增一篇坑文档。后端技能打包链（skills_bundle_service）无需改动——manifest 版本是内容 SHA，文件变了版本自动变，daemon 侧自动拉新。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立——纯静态文件同步，无事件流；init 为版本感知幂等重入，重复跑结果一致。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   同步期间若有其它会话同时改这些目录会冲突——本次变更前 `git status` 已知有 3 个外来 menu-permissions 脏文件（其它会话工作），提交时按文件白名单显式 add 避开；`.zcode/` 因 .gitignore 整目录忽略需 `add -f`。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   init 中断可重跑（幂等）；最坏情况 `git checkout` 恢复单文件。src 提交与 flow done 归档按坑文档 thin-done-src-commit-order 时序分离（先提交 `(2026-10-08-sync-sillyspec-skills-3320)` 半角括号归属，再跑 flow done）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   仅本仓库；`sillyspec init` 在主仓根目录跑（CLAUDE.md 规则 22），不进 worktree，不产生跨仓分裂的进度库。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：`sillyspec init` 附带刷新命令卡/指引等非技能面（v3.29.3→3.32.0 间的教学面变化），diff 面比预期大——处置：跑完后逐文件审 `git status`/`git diff`，实际改动面为「技能 + AGENTS.md 版本行 + 命令卡 + .gitignore 行尾抖动（已还原）」，无意外面。放弃方案：手写脚本只拷技能目录——放弃理由：绕开 CLI 幂等注入逻辑，AGENTS.md 版本段与命令卡仍会落后，且失去历史惯例的一致性；docker 镜像内直接改——放弃理由：镜像重建即丢，仓库才是唯一源。

## 验收命令（FR-01..04 对账，实跑为准）

```bash
# 计数：四目录均应为 21
for d in .claude .codex .opencode .zcode; do ls $d/skills | grep -c '^sillyspec-'; done
# 逐字节：四目录 vs npm 3.32.0 包（/tmp/ss3320/package）sillyspec 技能 diff 全空
# AGENTS.md 注入段版本：grep 'SillySpec v' AGENTS.md 显示 v3.32.0
# 坑文档存在且活跃：grep 'status: 活跃' docs/sillyspec/init-skills-sync-no-zcode.md
```

实跑结果（2026-10-08）：四目录 count=21、文件清单与内容 diff 全空（ALL-FOUR-MATCH-NPM-3320）；AGENTS.md 注入段 v3.32.0（仅版本行变化）；坑文档已落盘。
