---
author: qinyi
created_at: 2026-08-26 21:58:10
change: 2026-08-26-workspace-git-status
---
# 提案书（Proposal）

## 动机

工作区 Git 日志视图（2026-08-25 变更）解决的是"看历史"，但用户日常更高频的问题是"现在的状态"——我在哪个分支、本地改了多少还没提交、有多少没推送、远程有没有新东西。这些信息目前要切到本地 IDE 或终端才能看到，且「会话」页（与 agent 协作的主战场）完全没有 git 上下文。

## 关键问题

1. 平台无任何 git 状态数据端点（分支/ahead/behind/dirty 均缺失，上一变更只做了历史查询）。
2. 远程新鲜度需要 fetch：网络慢/凭证失败不能拖垮页面（用户拍板自动 fetch，须有超时与降级）。
3. 两个页面（Git 日志 / 会话）需要同一份数据且避免重复 fetch 远程。

## 变更范围

- daemon：host-fs-handler 新增 `git_status`（第 5 个平名 git 方法；fetch 15s 降级 + porcelain v2 + numstat --no-renames）
- backend：git_log 模块新增 `GET /git-log/status` 轻端点 + GitLogStatusResponse
- frontend：useGitLogStatus（staleTime 60s）+ git-status-bar 共享组件（full/compact）挂两页；gen:types 再生成
- 详见 design.md §6（约 12 文件）

## 不在范围内（显式清单）

- 任何 git 本地写操作（pull/commit/push/stash）
- 状态自动轮询（不设 refetchInterval）
- 单文件级改动明细（汇总行数，明细走 Git 日志页既有能力）
- submodule/worktree 递归聚合

## 成功标准（可验证）

- Git 日志页 PageHeader 下显示完整态状态条：分支徽标 + 跟踪 upstream + ↑未推送 + ↓远程新提交 + 改动 +A/−D（N 文件）+ 未跟踪数 + 同步时间
- 会话页标题右侧显示紧凑态（仅 workspace scope；平台/change/quicklog scope 不挂）
- 打开页面自动后台 fetch 一次；fetch 失败黄条"无法连接远程，显示上次同步数据"且其余字段照常
- 无 upstream（无 ↑↓）、detached HEAD（短哈希）、空仓库、非 git 工作区四类边界形态正确
- 两页 60s 内共享缓存只触发一次远程 fetch（组件测试断言）
- 三主题 token 合规零硬编码；backend/daemon/frontend 测试全绿零回归；gen:types 产物提交
