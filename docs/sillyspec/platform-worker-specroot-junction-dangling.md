# 平台分身（dispatch_worker）结束后 spec 根 junction 未还原 → sillyspec fail-closed

- 发现：2026-11-06（会话分叉事故排查日，实证）
- 状态：活跃坑（平台 daemon 侧待修复）

## 现象

派只读分身（dispatch_worker）到工作区绑定机器后，分身结束、worktree 被清理（`.worktrees/<worker-id>` 清成空目录），但平台在派发时把 `~/.sillyhub/daemon/specs/<workspace-id>` junction 切到分身 worktree 的 `.sillyspec` 的操作**没有还原**——junction 悬空。此后本机所有 sillyspec 写面命令（flow start / run 等）报：

```
❌ 平台 spec 根解析失败（fail-closed…）：pointer.specRoot 路径不存在（daemon 未起？已迁移？）
```

## 实证（2026-11-06 22:36 案例）

- `b97f8231-…` junction 于 22:36（分身派发时）被指向 `…\.worktrees\e74360dc\.sillyspec`（分身 worktree）；
- 分身 22:57 完成、converge_mission 合并后 worktree 内容被清（`.sillyspec` 子目录消失）→ junction 断链；
- 同仓 `29f4a6d1-…` junction（10-20 建）同指主仓库 `.sillyspec`——多 workspace id 并存时以 `.sillyspec-platform.json` 指针为准（当时指向 b97f8231）。

## 手工修复（验证有效）

```cmd
rmdir <specs>\<workspace-id>          :: 只删链接不删目标
mklink /J <specs>\<workspace-id> <主仓库>\.sillyspec
```

同目录另有 `b97f8231.wrong-junction-backup-20261104@`（11-04 修错链的历史备份），说明 junction 错指/悬空非首次发生。

## 根治方向（平台 daemon 侧）

分身生命周期收口（converge/清理 worktree）时还原 spec 根 junction 到派发前目标；或派发即快照 junction 目标、悬空检测自愈。修复前，并行会话若遇上述 fail-closed 报错，先按上面两命令自查自愈（rmdir 对 junction 安全）。
