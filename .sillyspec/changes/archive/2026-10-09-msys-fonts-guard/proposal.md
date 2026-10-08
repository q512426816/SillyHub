---
author: flow-machine-draft
created_at: 2026-10-08T17:51:46.012Z
---
# 提案书（Proposal）— 2026-10-09-msys-fonts-guard

## 动机

任务原话转写：动机：24 小时风险审查实证 deploy/scripts/onlyoffice-restore-fonts.sh 两处 docker exec 裸 POSIX 绝对路径参数（/usr/share/fonts/truetype/founder、/office-cn）在 Git Bash/MSYS 下被改写成 Windows 路径致脚本中断——同文件 L41-42/L49 已带 MSYS_NO_PATHCONV=1 前缀，仅 43-46 漏加（9d2702ffe 只修了 build-and-save.sh 一处同类问题）；另有 .claude/.codex 两份 sillyhub-docker-deploy 技能文档副本仍指导已退役的 claude-data 卷挂载与容器内 claude --version 验证（85c8704a7 只同步了 .zcode 副本，md5 实证漂移）。

成功标准：
- onlyoffice-restore-fonts.sh 两处 tar 解包 docker exec 与同文件既有调用一致带 MSYS_NO_PATHCONV=1，Git Bash 下路径参数不再被 MSYS 改写
- .claude/skills/sillyhub-docker-deploy/SKILL.md 与 .codex 副本同步为 .zcode 现行版内容（claude-data 卷/claude --version 等退役面描述消除）
- shell 语法门通过（bash -n），无其它回归面（脚本其余行零改动）

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. onlyoffice-restore-fonts.sh 两处 tar 解包 docker exec 与同文件既有调用一致带 MSYS_NO_PATHCONV=1，Git Bash 下路径参数不再被 MSYS 改写
2. .claude/skills/sillyhub-docker-deploy/SKILL.md 与 .codex 副本同步为 .zcode 现行版内容（claude-data 卷/claude --version 等退役面描述消除）
3. shell 语法门通过（bash -n），无其它回归面（脚本其余行零改动）

## 成功标准（可验证）

1. onlyoffice-restore-fonts.sh 两处 tar 解包 docker exec 与同文件既有调用一致带 MSYS_NO_PATHCONV=1，Git Bash 下路径参数不再被 MSYS 改写
2. .claude/skills/sillyhub-docker-deploy/SKILL.md 与 .codex 副本同步为 .zcode 现行版内容（claude-data 卷/claude --version 等退役面描述消除）
3. shell 语法门通过（bash -n），无其它回归面（脚本其余行零改动）
