# sillyspec CLI cwd 耦合（worktree 内跑把 cwd 当独立 spec root，进度库分裂）

> 记录时间：2026-10-12 · 来源变更：2026-10-12-session-defects（生产实证：平台会话 47e2ff1a）
> 状态：活跃坑（现有绕过方案可靠，待工具修复）

## 现象

在 SillySpec worktree（或任何主仓根以外的子目录）内执行 sillyspec CLI 命令（如
`sillyspec task tick` / `task finish` / `progress show`），CLI 把当前工作目录当作
独立 spec root：找不到变更（「无进行中标记」「spec root 找不到变更」）或在
worktree 内写出与主仓分裂的进度库 / artifact / QUICKLOG。

生产实证：会话 47e2ff1a（消防设施器材1轮）中出现 8 条「CLI 错误目录」相关日志——
主代理三次明确「回主工作区重跑」（10-10 06:13、06:31、06:53 前后），每次浪费
1-2 个交互来回。

## 根因

CLI 的 spec root 定位策略是「取进程 cwd 向上找 `.sillyspec`」：
- worktree 内 checkout 了完整 `.sillyspec/` 副本 → CLI 命中副本，把它当权威；
- 子目录（如 `backend/`）内跑 → 向上探测落在错误边界或找不到。

## 影响

- 进度库（sillyspec.db）双写分裂：worktree 副本里的进度主仓读不到；
- patch 留档 / artifact / QUICKLOG 写丢或写错位置；
- 任务勾选状态不同步，execute 收口门对不上账。

## 绕过

一律在主仓根目录跑 sillyspec CLI（CLAUDE.md 规则 22）；需要在 worktree/子目录读
代码时用绝对路径或 `git -C <path>`，绝不 `cd`。注意 bash cwd 在调用间持久——
复合命令里 `cd` 进 worktree 后，后续命令即使写在同一行也会继承污染后的 cwd。

## 期望修复

CLI 从 `SILLYSPEC_SESSION_ID` / 环境变量 / `.sillyspec/.runtime` 锚点自动定位主仓
根（类似 endpoints baseline 的「自动把扫描根锚定主仓」行为），对 worktree cwd
给出警告而非静默分裂。

## 处置记录（2026-10-13）——部分在位，主体延后

**现有防线核实**（部分缓解已非坑文所述裸奔态）：CLI 入口已有 `detectCwdInsideWorktree`
硬守卫（`src/index.js:380` 起全命令面消费——worktree 内跑命令会被拦/警告而非静默分裂，
坑 register-stage-review-cwd 深根修复轮同款机制）；`readPlatformConfig` 凭据链有向上
7 级回退；CLAUDE.md 规则 22 是行为守则面。坑文的「进度库双写分裂」在现代版本已被入口
守卫大幅收窄。

**延后**：坑期望的「自动锚定主仓根（session/env/runtime 锚点）+ 对 worktree cwd 警告
而非拦截」是入口行为语义变更（拦→导），涉及全命令面与平台 worktree 模式（daemon 机
specRoot 异位形态）的根定位策略重构——设计级另立变更，现有守卫 + 规则 22 + bash cwd
持久性提示（坑内绕过节已述）构成可用防线。本文件保持活跃跟踪。

## 处置收口（2026-10-20 关闭：延后项已落地）

- **「拦→导」已实现**（sillyspec 仓 2026-10-20-cli-worktree-cwd-anchor，归档 a7b9764c）：CLI 入口对 worktree cwd 由 exit 2 硬拦改为 ⚠️警告（变更名/原 cwd/锚定主仓根/逃生门整行）+ 自动重锚定主仓根执行（dir 与同 worktree 的显式 --spec-dir 一并锚定——评审 P2 清偿）；--allow-worktree-cwd 零警告零锚定、wt-commit 豁免、--dir 口径不变；写入恒落主仓（worktree 副本零 CLI 写入，单源不变量延续）。生产痛点（会话 47e2ff1a 三次被拦每次 1-2 来回）消除。独立评审 PASS（P2/P3①/P3② 三项清偿复核确认）；worktree-cwd-guard 10/10 + 守卫引用面 8 套件全绿。
- 设计取舍注记：锚定采用路径结构锚点（detectCwdInsideWorktree 的 mainRepoRoot），未用坑文提及的 session/env 锚点——env 是多会话共享值不标识仓根，路径锚点对 worktree 场景已完备（该变更 design 弃案①）。
- 处置结论：延后的设计级变更已按「守卫建议的事自动做掉」落地，本文件移入 finished/。
