---
author: flow-machine-draft
created_at: 2026-10-23T06:01:11.085Z
---
# 提案书（Proposal）— 2026-10-23-skill-prune-git-safe

## 动机

任务原话转写：daemon 会话启动时的技能裁剪(pruneSkillsToSubset)直接 rm -rf 删除 git 仓库工作区里 .claude/skills 下的技能目录——2026-10-23 实证删掉 250 个 git 跟踪文件(11 个技能目录),污染工作区并被轮尾快照算进该会话卡片(329 文件怪物卡)。用户裁决(AskUserQuestion 拍板):修掉缺陷——技能裁剪改成只在平台自己管理的副本目录里操作,项目文件夹一律不碰。

成功标准：
- git 跟踪的技能目录(.claude/skills/<名> 在 git ls-files 命中)一律不删除,即使不在本会话 skillRefs 清单
- 未被 git 跟踪且目录名属于 daemon 技能库(~/.sillyhub/daemon/skills 同步源)的目录仍被裁剪(裁剪功能对非 git 场景不失效)
- 非 git 仓工作目录:仅删除目录名属于 daemon 技能库的目录,用户自建目录一律不删
- 删除条件收敛为三重与:不在 skillRefs ∧ 名在 daemon 技能库清单 ∧ 非 git 跟踪;任一不满足即保留
- 触及面 vitest 全绿 + pnpm exec tsc --noEmit 零类型错误

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. git 跟踪的技能目录(.claude/skills/<名> 在 git ls-files 命中)一律不删除,即使不在本会话 skillRefs 清单
2. 未被 git 跟踪且目录名属于 daemon 技能库(~/.sillyhub/daemon/skills 同步源)的目录仍被裁剪(裁剪功能对非 git 场景不失效)
3. 非 git 仓工作目录:仅删除目录名属于 daemon 技能库的目录,用户自建目录一律不删
4. 删除条件收敛为三重与:不在 skillRefs ∧ 名在 daemon 技能库清单 ∧ 非 git 跟踪;任一不满足即保留
5. 触及面 vitest 全绿 + pnpm exec tsc --noEmit 零类型错误

## 成功标准（可验证）

1. git 跟踪的技能目录(.claude/skills/<名> 在 git ls-files 命中)一律不删除,即使不在本会话 skillRefs 清单
2. 未被 git 跟踪且目录名属于 daemon 技能库(~/.sillyhub/daemon/skills 同步源)的目录仍被裁剪(裁剪功能对非 git 场景不失效)
3. 非 git 仓工作目录:仅删除目录名属于 daemon 技能库的目录,用户自建目录一律不删
4. 删除条件收敛为三重与:不在 skillRefs ∧ 名在 daemon 技能库清单 ∧ 非 git 跟踪;任一不满足即保留
5. 触及面 vitest 全绿 + pnpm exec tsc --noEmit 零类型错误
