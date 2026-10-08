---
author: flow-machine-draft
created_at: 2026-10-08T03:10:03.162Z
---
# 设计记录（Design Record）— 2026-10-08-backend-image-slim-no-claude

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

backend 镜像自 server-local 时代起携带 claude-code + node 全家桶 + entrypoint 的 .claude settings 生成与插件市场同步；2026-07-10 D-007 删除 server-local 模式后这些全是遗物（证据：placement.py:316 注明 SERVER subprocess backend removed / Daemon-Only；backend/app 全量 grep 无 claude/node/sillyspec 子进程 spawn，唯二 exec 是 git——config.py:570 COMMIT_SHA 回退与 diff_collector.py:124/153 git diff；无 /app/.claude/settings.json 读者）。容器真正的运行职责：python API + 静态分发（技能 manifest/bundle、daemon bundle）。

方案：node-tools 阶段 npm 只装 sillyspec（技能源）；runtime 删 node/npm/npx/claude/sillyspec 二进制与 node_modules COPY 及 ln 块，新增 package.json 焙入 /app/sillyspec-package.json（无 node 环境下的版本回显锚点）；entrypoint 删 settings.json 生成块/插件同步块/.claude 软链（保留 git config 与 /data 初始化）；compose 删 claude-data 卷挂载与声明、NPM_CONFIG_CACHE、CLAUDE_CODE_VERSION build arg；build-and-save.sh 版本回显改读焙入件。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无 Python/TS 代码接口变化，API 端点行为零变化。可见变化全在镜像/容器层：镜像体积显著缩小；容器内不再有 node/npm/npx/claude/sillyspec 可执行（排障需用 python/git/curl/sh）；/app/.claude 不再初始化（claude-data 卷不再挂载，宿主数据保留）；.env 的 CLAUDE_CODE_VERSION/ANTHROPIC_*/CLAUDE_PLUGIN_* 等行对容器变惰性（daemon 侧凭据链路不受影响）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立——纯静态镜像内容变更，无事件流；「容器内无人用这些二进制」的证据是全量 grep（backend/app）而非运行时探测，构建即固化。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   变更时共享仓有并行会话脏文件，提交用显式 pathspec（backend/Dockerfile、backend/docker-entrypoint.sh、deploy/docker-compose.yml、deploy/scripts/build-and-save.sh、.zcode skill 文档）；claude-data 卷移除只影响新容器，卷数据宿主留存。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   在途 agent 会话不受影响（执行在宿主 daemon，与容器无涉）；容器重建后 /api/health 与分发端点照常；回滚走既有 backup tag 机制。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   只影响本仓 backend 镜像；服务器走 load 镜像同源；宿主 daemon 安装链（/daemon/install.sh）分发的是 COPY 进镜像的静态 bundle，与容器内二进制无关。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：证据面有盲区——若存在 grep 未覆盖的运行时 claude/node 依赖（如未来新代码 spawn），容器将直接 FileNotFoundError。缓解：唯二 exec 点已逐行核实为 git；diff_collector 的 FileNotFoundError 分支本就按零 diff 降级不炸；变更后本地重建全链路验证 + 服务器部署后复验。放弃方案：①保留 node 只删 claude——放弃理由：node+npm+node_modules 占大头（claude 二进制本身不大，大头是其 node_modules），半删收益减半且留「半个遗物」心智负担；②只注释不删除（防御性保留）——放弃理由：镜像层一旦保留就会被后人当成可用能力写代码，遗物越藏越深；③compose 保留 claude-data 挂载以防万一——放弃理由：卷挂载会遮盖 /app/.claude 目录语义，与「容器内无 claude」的新事实矛盾。

## 验收命令（FR-01..04 对账，实跑为准）

```bash
bash -n deploy/scripts/build-and-save.sh && docker compose --env-file deploy/.env -f deploy/docker-compose.yml config >/dev/null
grep -c "claude-code\|CLAUDE_CODE_VERSION" backend/Dockerfile   # 期望 0（注释中 claude-code 字样除外，人工审）
SILLYSPEC_REFRESH=$(date +%s) docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build --force-recreate -d backend
# 容器内：which node npm claude sillyspec（全空）/ ls /app/sillyspec-skills | grep -c ^sillyspec-（21 含 flow）
# /api/health ok / manifest has-flow=True / docker images SIZE 对比
cd backend && python -m pytest tests/test_daemon_dist.py -q
```
