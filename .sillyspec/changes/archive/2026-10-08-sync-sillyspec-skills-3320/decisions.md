---
author: flow-machine-draft
created_at: 2026-10-08T02:08:13.310Z
---
# 决策记录（Decisions）— 2026-10-08-sync-sillyspec-skills-3320

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：`sillyspec init` 附带刷新命令卡/指引等非技能面（v3.29.3→3.32.0 间的教学面变化），diff 面比预期大——处置：跑完后逐文件审 `git status`/`git diff`，实际改动面为「技能 + AGENTS.md 版本行 + 命令卡 + .gitignore 行尾抖动（已还原）」，无意外面。放弃方案：手写脚本只拷技能目录——放弃理由：绕开 CLI 幂等注入逻辑，AGENTS.md 版本段与命令卡仍会落后，且失去历史惯例的一致性；docker 镜像内直接改——放弃理由：镜像重建即丢，仓库才是唯一源。
