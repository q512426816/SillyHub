---
author: flow-machine-draft
created_at: 2026-10-23T06:01:11.085Z
---
# 任务注册表（Tasks）— 2026-10-23-skill-prune-git-safe

- [x] task-01: git 跟踪的技能目录(.claude/skills/<名> 在 git ls-files 命中)一律不删除,即使不在本会话 skillRefs 清单
- [x] task-02: 未被 git 跟踪且目录名属于 daemon 技能库(~/.sillyhub/daemon/skills 同步源)的目录仍被裁剪(裁剪功能对非 git 场景不失效)
- [x] task-03: 非 git 仓工作目录:仅删除目录名属于 daemon 技能库的目录,用户自建目录一律不删
- [x] task-04: 删除条件收敛为三重与:不在 skillRefs ∧ 名在 daemon 技能库清单 ∧ 非 git 跟踪;任一不满足即保留
- [x] task-05: 触及面 vitest 全绿 + pnpm exec tsc --noEmit 零类型错误
