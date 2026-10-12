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
