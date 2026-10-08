---
author: flow-machine-draft
created_at: 2026-10-08T17:51:46.012Z
---
# 任务注册表（Tasks）— 2026-10-09-msys-fonts-guard

- [x] task-01: onlyoffice-restore-fonts.sh 两处 tar 解包 docker exec 与同文件既有调用一致带 MSYS_NO_PATHCONV=1，Git Bash 下路径参数不再被 MSYS 改写
- [x] task-02: .claude/skills/sillyhub-docker-deploy/SKILL.md 与 .codex 副本同步为 .zcode 现行版内容（claude-data 卷/claude --version 等退役面描述消除）
- [x] task-03: shell 语法门通过（bash -n），无其它回归面（脚本其余行零改动）
