---
author: flow-machine-draft
created_at: 2026-10-08T02:38:28.292Z
---
# 需求规格（Requirements）— 2026-10-08-backend-skills-follow-cli

## 功能需求

### FR-01: backend/Dockerfile 技能 COPY 源从仓库快照(additional_contexts skills)改为 node-tools 阶段已装 sillyspec 包的 .claude/skills

- 必须：镜像内 `/app/sillyspec-skills/` 的内容来自 `COPY --from=node-tools /usr/local/lib/node_modules/sillyspec/.claude/skills`，与容器内安装的 sillyspec CLI 同包同版；`deploy/docker-compose.yml` 移除已无消费者的 `skills: ../.claude/skills` additional_context。

#### 场景：主路径

- Given 原技能来自仓库 `.claude/skills` 构建快照（与容器 CLI 版本可能错位）
- When CLI 随 SILLYSPEC_REFRESH 拉到任意新版
- Then `/app/sillyspec-skills` 自动是同版技能（lockstep），无需仓库先行刷新

### FR-02: npm 安装层引用 SILLYSPEC_REFRESH arg（时间戳爆破缓存），deploy/docker-compose.yml 传参、build-and-save.sh 每次打包自动导出新时间戳并回显镜像内 sillyspec 版本

- 必须：`backend/Dockerfile` node-tools 阶段声明 `ARG SILLYSPEC_REFRESH` 且 RUN 命令引用它（缓存键含该值）；compose backend args 透传 `${SILLYSPEC_REFRESH:-}`；`build-and-save.sh` 每次导出 `date +%Y%m%d%H%M%S` 时间戳并在打包后打印镜像内 `sillyspec --version`。

#### 场景：主路径

- Given SILLYSPEC_VERSION 留空（latest）+ npm 层存在旧缓存
- When build-and-save.sh 打包（新时间戳）
- Then npm 层缓存被爆破真拉 latest，输出行显示拉到的版本

### FR-03: deploy/.env 的 SILLYSPEC_VERSION 置空并注释为应急回滚口（默认走 npm latest）

- 必须：`deploy/.env` 中 `SILLYSPEC_VERSION=3.32.0` 行注释掉（等效空值=latest），注释说明 pin 仅应急回滚用。

#### 场景：主路径

- Given 昨日 pin 了 3.32.0
- When 改为注释留空
- Then compose 构建走 npm latest；需要回滚时取消注释填旧版

### FR-04: 本地带 refresh 重建后容器内 sillyspec 版本=npm latest 且 /app/sillyspec-skills 与该版本技能数一致（21 个含 flow）、health ok

- 必须：`SILLYSPEC_REFRESH=<新值> docker compose build backend` + `--force-recreate` 后，容器内 `sillyspec --version` 为 npm latest（当前 3.32.0），`ls /app/sillyspec-skills | grep -c '^sillyspec-'` = 21 且含 sillyspec-flow，`/api/health` ok。

#### 场景：主路径

- Given 新 Dockerfile（技能源=node-tools sillyspec 包）
- When 带 refresh 重建并重建容器
- Then CLI 与技能同版、服务健康

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：Dockerfile/compose 静态改动，验收以 grep 源行 + 重建后容器内清点为准
FR-02: 不适用：构建编排脚本，验收以 build-and-save.sh 语法（bash -n）+ 重建实跑回显为准
FR-03: 不适用：本地 gitignored 配置注释化，验收以 grep 为准
FR-04: 不适用：容器运行时行为，验收以重建后容器内实跑命令为准
