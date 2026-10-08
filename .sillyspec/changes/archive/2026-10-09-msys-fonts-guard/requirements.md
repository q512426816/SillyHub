---
author: flow-machine-draft
created_at: 2026-10-08T17:51:46.012Z
---
# 需求规格（Requirements）— 2026-10-09-msys-fonts-guard

## 功能需求

### FR-01: onlyoffice-restore-fonts.sh 两处 tar 解包 docker exec 与同文件既有调用一致带 MSYS_NO_PATHCONV=1，Git Bash 下路径参数不再被 MSYS 改写

- `deploy/scripts/onlyoffice-restore-fonts.sh` 的两处字体解包 `docker exec -i ... tar -C /usr/share/fonts/truetype/...` 必须带 `MSYS_NO_PATHCONV=1` 前缀（与同文件 mkdir/fc-cache 既有调用一致）；裸 POSIX 绝对路径参数禁止出现在无守卫的 docker 调用中。

#### 场景：Git Bash 下字体恢复不再中断

- Given Windows Git Bash 执行本脚本（头注释声明的用法形态）
- When 运行到字体解包两行
- Then `/usr/share/fonts/truetype/founder`、`/office-cn` 参数原样传入容器（不被 MSYS 改写成 `C:/Program Files/Git/usr/...`），tar 正常解包，脚本不因 `set -euo pipefail` 中断

### FR-02: .claude/skills/sillyhub-docker-deploy/SKILL.md 与 .codex 副本同步为 .zcode 现行版内容（claude-data 卷/claude --version 等退役面描述消除）

- `.claude/skills/sillyhub-docker-deploy/SKILL.md` 与 `.codex/skills/sillyhub-docker-deploy/SKILL.md` 的正文必须与 `.zcode` 现行版逐字一致（85c8704a7 只同步了 .zcode 副本的漏更），按旧文档操作不得再指导已退役的 claude-data 卷挂载或容器内 `claude --version` 验证。

#### 场景：三副本一致

- Given 85c8704a7 镜像瘦身后 .zcode 副本已更新、另两副本仍为 2026-08-13 旧版（md5 实证漂移）
- When 同步拷贝
- Then 三副本 md5 一致，旧版中「Claude Code CLI in the backend container」「claude-data 卷挂载」「claude --version 验证」等退役面描述不再出现

### FR-03: shell 语法门通过（bash -n），无其它回归面（脚本其余行零改动）

- 修改后的脚本必须通过 `bash -n` 语法门，且除两处守卫前缀与说明注释外脚本其余行必须零改动。

#### 场景：最小改动面

- Given 补丁应用后
- When `bash -n deploy/scripts/onlyoffice-restore-fonts.sh` 与 `git diff` 检视
- Then 语法门通过，diff 仅含两行守卫前缀 + 注释块 + 两份文档副本同步

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：运维脚本无自动化测试面——以 bash -n 语法门 + diff 检视（守卫前缀与同文件 L41-49 既有形态一致）为验证；实测受容器环境限制留给下次字体恢复实操
FR-02: 不适用：纯文档同步——以三副本 diff -q 一致性检查为验证（已实测 SYNCED）
FR-03: test/deploy/scripts/onlyoffice-restore-fonts.sh「bash -n 语法门通过（已实测 SYNTAX-OK）」
