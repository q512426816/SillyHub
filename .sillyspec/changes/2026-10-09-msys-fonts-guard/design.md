---
author: flow-machine-draft
created_at: 2026-10-08T17:51:46.012Z
---
# 设计记录（Design Record）— 2026-10-09-msys-fonts-guard

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

两处独立小改：(1) `deploy/scripts/onlyoffice-restore-fonts.sh` 的两行字体解包 `docker exec -i ... tar -C /usr/share/fonts/truetype/...` 补 `MSYS_NO_PATHCONV=1` 前缀——与同文件 mkdir（L41-42）与 fc-cache（L49）既有守卫形态完全一致，作者本知此坑仅这两行漏加（2026-10-09 风险审查实证；9d2702ffe 修 build-and-save.sh 时未覆盖此处）；补一行注释说明动机。(2) `.claude/skills/sillyhub-docker-deploy/SKILL.md` 与 `.codex/` 同名副本整文同步为 `.zcode` 现行版（cp 逐字拷贝）——85c8704a7 镜像瘦身只更新了 .zcode 副本，另两副本仍指导已退役的 claude-data 卷挂载与容器内 `claude --version` 验证（md5 实证漂移，最后改动 2026-08-13）。选整文 cp 而非逐段手改：三副本本就互为镜像，逐字一致可被 diff -q 验证，不引入转录错误。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `deploy/scripts/onlyoffice-restore-fonts.sh`：调用形态变化——两处 docker exec 增加 `MSYS_NO_PATHCONV=1` 环境前缀（该变量仅 MSYS 运行时识别，Linux 服务器上执行零影响）；脚本用法/参数/行为语义零变化。
- `.claude/skills/sillyhub-docker-deploy/SKILL.md`、`.codex/skills/sillyhub-docker-deploy/SKILL.md`：正文内容同步（frontmatter 未动，diff 从正文 L10 起）；对 AI 工具是文档面，无代码契约。
- 后端 / 前端 / daemon 代码：零改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不适用：脚本顺序执行 + 管道两段（tar 产流 → docker 消费流），守卫前缀只改参数改写行为不改管道时序；文档同步无事件面。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用：脚本自身无锁/共享文件面（字体目录在容器内，脚本调用约定单次执行）；文档副本为 git 管理的静态文件。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：脚本中断语义保持既有 `set -euo pipefail`（任一步失败即停，字体索引重建可重跑幂等）；守卫前缀不改变失败传播。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不适用：脚本作用于单机单容器（容器名参数化），MSYS_NO_PATHCONV 是进程级环境前缀只影响该命令行；文档同步是仓库内三副本。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：无自动化测试钉住脚本行为（运维脚本无测试面），守卫正确性靠 bash -n + 与同文件既有守卫形态的目视一致性；真实解包验证留待下次字体恢复实操（容器重建后场景）。文档整文拷贝的风险是若 .zcode 版自身有误则三副本同错——但 .zcode 版是 85c8704a7 变更同步过的现行真相，方向上优于两份 2026-08-13 旧版。试过放弃：(a) 在脚本头部统一 export MSYS_NO_PATHCONV=1——放弃，作用域大于必要（会影响脚本内一切命令的路径转换，包括可能的宿主路径场景），同文件既有惯例是逐命令前缀；(b) 只更新漂移段落——放弃，逐段手改引入转录风险且不可 diff -q 验证。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | deploy/scripts/onlyoffice-restore-fonts.sh | 两处 docker exec tar 补 MSYS_NO_PATHCONV=1 + 注释 |
| 修改 | .claude/skills/sillyhub-docker-deploy/SKILL.md | 同步 .zcode 现行版 |
| 修改 | .codex/skills/sillyhub-docker-deploy/SKILL.md | 同步 .zcode 现行版 |
