---
author: flow-machine-draft
created_at: 2026-09-25T23:44:30.313Z
---
# 提案书（Proposal）— 2026-09-26-deploy-eng-hardening

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:cda82776675799d1dfd418ca71084c79f9b8d2722b74ae2c086958dd134e1dec:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-deploy-eng-hardening 留痕重锚 -->
任务原话转写：动机：deploy/工程面五处积压的运维可见性与防护缺口（本轮负面清单第四/五类）：①/api/health commit_sha 恒 unknown（无法确认生产版本，逼出「靠行为差异反推旧后端」）；②build-and-save.sh 尾部提示的 scp 目标目录错（/opt/sillyhub/deploy/ 而非双层活跃目录 deploy/deploy/，照抄会放错位置）；③镜像 backup tag 无自动清理（本轮已积 7 个 ×908MB ≈ 6.4G，40G 盘只剩 7.4G）；④gen:types 无并行会话防护（openapi.json 有未提交改动时重生成会把对方 WIP 卷进自己的提交——本轮真实踩过）；⑤并行会话 git index.lock 竞态无重试指引（本轮真实撞过）。

成功标准：
- backend 镜像构建时 COMMIT_SHA 构建参数注入 git rev-parse --short HEAD，且 docker-compose.yml 不再用空默认值覆盖镜像内置 env（health 端点 commit_sha 显示真实提交）
- build-and-save.sh 完成提示的 scp/ssh 命令改为双层活跃目录 /opt/sillyhub/deploy/deploy/（与技能文档一致）
- load-and-up.sh 增 backup tag 保留策略：只保留最近 4 个 multi-agent-platform-{backend,frontend}:backup-*，更旧的 docker rmi
- scripts/gen-api-types.mjs 前置守卫：backend/openapi.json 或 frontend/src/lib/api-types.ts 存在未提交改动时中止并提示（--force 跳过；并行会话先提交或 stash）
- 新增 scripts/git-safe.sh：git 操作遇 index.lock 竞态自动等待重试（默认 30s 超时），供并行会话 commit/amend 用
- 上述脚本改动本地可验（不部署：COMMIT_SHA 经本地构建验证进镜像 env；load-and-up 语法 bash -n；gen 守卫用脏工作区实测拦截）
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:bb6354fc0e1d911b0ebf5d21c57f3f7957ed038b1b7e200f3a57b7e6e76f72f0:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-deploy-eng-hardening 留痕重锚 -->
按成功标准机械推导，共 9 条验收面：
1. backend 镜像构建时 COMMIT_SHA 构建参数注入 git rev-parse --short HEAD，且 docker-compose.yml 不再用空默认值覆盖镜像内置 env（health 端点 commit_sha 显示真实提交）
2. build-and-save.sh 完成提示的 scp/ssh 命令改为双层活跃目录 /opt/sillyhub/deploy/deploy/（与技能文档一致）
3. load-and-up.sh 增 backup tag 保留策略：只保留最近 4 个 multi-agent-platform-{backend,frontend}:backup-*，更旧的 docker rmi
4. scripts/gen-api-types.mjs 前置守卫：backend/openapi.json 或 frontend/src/lib/api-types.ts 存在未提交改动时中止并提示（--force 跳过
5. 并行会话先提交或 stash）
6. 新增 scripts/git-safe.sh：git 操作遇 index.lock 竞态自动等待重试（默认 30s 超时），供并行会话 commit/amend 用
7. 上述脚本改动本地可验（不部署：COMMIT_SHA 经本地构建验证进镜像 env
8. load-and-up 语法 bash -n
9. gen 守卫用脏工作区实测拦截）
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:51eaf110db0d874f28a400342f13446fdf05148c740679605fb8109501db4518:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-deploy-eng-hardening 留痕重锚 -->
1. backend 镜像构建时 COMMIT_SHA 构建参数注入 git rev-parse --short HEAD，且 docker-compose.yml 不再用空默认值覆盖镜像内置 env（health 端点 commit_sha 显示真实提交）
2. build-and-save.sh 完成提示的 scp/ssh 命令改为双层活跃目录 /opt/sillyhub/deploy/deploy/（与技能文档一致）
3. load-and-up.sh 增 backup tag 保留策略：只保留最近 4 个 multi-agent-platform-{backend,frontend}:backup-*，更旧的 docker rmi
4. scripts/gen-api-types.mjs 前置守卫：backend/openapi.json 或 frontend/src/lib/api-types.ts 存在未提交改动时中止并提示（--force 跳过
5. 并行会话先提交或 stash）
6. 新增 scripts/git-safe.sh：git 操作遇 index.lock 竞态自动等待重试（默认 30s 超时），供并行会话 commit/amend 用
7. 上述脚本改动本地可验（不部署：COMMIT_SHA 经本地构建验证进镜像 env
8. load-and-up 语法 bash -n
9. gen 守卫用脏工作区实测拦截）
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
