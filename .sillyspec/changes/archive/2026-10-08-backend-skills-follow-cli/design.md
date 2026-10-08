---
author: flow-machine-draft
created_at: 2026-10-08T02:38:28.292Z
---
# 设计记录（Design Record）— 2026-10-08-backend-skills-follow-cli

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

问题：平台侧 CLI 与技能是两股道——CLI 来自镜像 npm 层（SILLYSPEC_VERSION 空时被 Docker 层缓存冻结在首次构建版本，容器 3.26.0 vs latest 3.32.0 实证），技能来自仓库 `.claude/skills` 构建快照；任一侧自动前进都会与另一侧错位（本次用户诉求=要自动升级）。

方案：①技能源改为已安装 sillyspec 包自带的 `.claude/skills`（`COPY --from=node-tools /usr/local/lib/node_modules/sillyspec/.claude/skills`）——同包同版天然 lockstep，CLI 升到哪技能跟到哪；②npm 层加 `SILLYSPEC_REFRESH` 时间戳 build-arg 爆破缓存，`build-and-save.sh` 每次打包导出新时间戳强制真拉 latest，并回显镜像内版本；③`deploy/.env` 的 pin 注释化，降级为应急回滚口。仓库 `.claude/skills` 等四镜像目录保留服务本地工具面（ZCode/Claude CLI），仍由 `sillyspec init` 手刷（低频）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无后端/前端代码接口变化。变化面：`backend/Dockerfile`（npm RUN 加 refresh echo；技能 COPY 换源）、`deploy/docker-compose.yml`（backend args 增 SILLYSPEC_REFRESH、移除 skills additional_context）、`deploy/scripts/build-and-save.sh`（导出时间戳 + 打包后回显镜像内 sillyspec 版本）、`deploy/.env`（本地 gitignored，pin 注释化）。行为变化：每次打包镜像内 sillyspec = npm latest 且技能同版；compose additional_contexts 的 `skills` 键退役（无消费者）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立——无事件流；同一 SILLYSPEC_REFRESH 值构建可复现（缓存键含值），不同值=重拉。npmmirror 同步 npmjs 有分钟级滞后，latest 取到的是镜像源当前最新，可接受（应急时 pin 绕过）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   构建单线程产出镜像 tag；deploy/.env 仅本机会话改。变更时 git status 干净（无外来脏文件），提交用显式 pathspec。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   容器重建与历次部署一致（平台自身生命周期管理）；镜像内技能/CLI 是构建期固化产物，运行时只读。回滚走既有 backup tag 机制 + .env pin 应急口。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   只影响本仓镜像构建；服务器端不构建（load 镜像），本地工具面（.zcode/.claude 等）不经镜像，互不影响。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：sillyspec 未来版本改包内目录布局（`.claude/skills` 移位）→ COPY 构建期失败（fail-closed 可见，非运行期暗病）；其次 npm latest 引入破坏性变更直进生产（无 pin 缓冲）——缓解：build-and-save.sh 回显版本留痕、backup tag + .env pin 双回滚口，且 sillyspec 是用户自研工具、发布节奏自控。放弃方案：①保留仓库快照源 + 定期 init 刷新——放弃理由：自动化仍靠人记着做，正是本次要消灭的错位根源；②容器启动时 runtime npm install 拉最新——放弃理由：启动时延+网络依赖+镜像内容不确定（同 tag 不同行为），破坏回滚语义；③CI 定时重建——放弃理由：当前无 CI 部署链，超出本变更面。

## 验收命令（FR-01..04 对账，实跑为准）

```bash
bash -n deploy/scripts/build-and-save.sh   # 脚本语法
grep -n "SILLYSPEC_REFRESH" backend/Dockerfile deploy/docker-compose.yml deploy/scripts/build-and-save.sh
grep -n "node-tools /usr/local/lib/node_modules/sillyspec/.claude/skills" backend/Dockerfile
SILLYSPEC_REFRESH=$(date +%s) docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build --force-recreate -d backend
# 容器内：sillyspec --version（=npm latest）/ ls /app/sillyspec-skills | grep -c ^sillyspec-（=21 含 flow）/ curl /api/health
```
