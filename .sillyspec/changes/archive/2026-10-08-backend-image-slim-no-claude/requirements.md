---
author: flow-machine-draft
created_at: 2026-10-08T03:10:03.162Z
---
# 需求规格（Requirements）— 2026-10-08-backend-image-slim-no-claude

## 功能需求

### FR-01: backend/Dockerfile：npm install 不装 claude-code；runtime 不再 COPY node/npm/node_modules 与 ln 二进制；sillyspec 包 package.json 焙为 /app/sillyspec-package.json

- 必须：node-tools 阶段 `npm install -g` 仅装 sillyspec（无 @anthropic-ai/claude-code）；runtime 阶段无 node/npm/npx/claude/sillyspec 二进制与 node_modules COPY、无 ln 符号链；`COPY --from=node-tools .../sillyspec/package.json /app/sillyspec-package.json` 存在；runtime ENV 删 CLAUDE_CODE_VERSION/SILLYSPEC_VERSION/NPM_CONFIG_CACHE（无读者）。

#### 场景：主路径

- Given 原镜像携带 claude-code + node 全家桶（server-local 遗物）
- When 重建镜像
- Then 容器内 `which node claude sillyspec npm` 全部为空；/app/sillyspec-skills 技能 21 个照常

### FR-02: docker-entrypoint.sh：删 settings.json 生成块与 claude 插件同步块与 .claude skills 软链；保留 git config 与 /data 初始化

- 必须：entrypoint 仅保留 `mkdir -p /data/spec-workspaces`、`git config --global --add safe.directory '*'`、`exec "$@"`；无 python settings.json 块、无 is_enabled/claude plugin 块、无 .claude 软链。

#### 场景：主路径

- Given 原 entrypoint 生成 /app/.claude/settings.json 并同步插件市场
- When 新 entrypoint 启动容器
- Then 启动直接到 alembic + uvicorn（无 claude 调用；backend 无 settings.json 读者已核）

### FR-03: deploy/docker-compose.yml：backend 删 claude-data 卷挂载、NPM_CONFIG_CACHE env、CLAUDE_CODE_VERSION build arg

- 必须：backend volumes 无 `claude-data:/app/.claude`；顶层 volumes 声明无 claude-data；environment 无 NPM_CONFIG_CACHE；build args 无 CLAUDE_CODE_VERSION。.env 残留 CLAUDE_CODE_VERSION/ANTHROPIC_*/CLAUDE_* 行为惰性（无消费者），不动。

#### 场景：主路径

- Given claude-data 卷只被 backend 挂载（grep 全文件唯一）
- When 移除挂载与声明
- Then `docker compose config` 通过；named volume 数据留宿主磁盘不受影响

### FR-04: build-and-save.sh 版本回显改读 /app/sillyspec-package.json；本地重建后 health ok、技能 21 含 flow、manifest 正常、容器内无 node/claude/sillyspec 可执行、镜像体积较前显著下降（报告前后 SIZE）；/daemon/* 分发端点与 daemon bundle COPY 不受影响

- 必须：脚本回显用 `--entrypoint grep ... /app/sillyspec-package.json`；本地重建后容器 `/api/health` ok、`ls /app/sillyspec-skills | grep -c '^sillyspec-'`=21 含 flow、manifest has-flow=True、`which node npm claude sillyspec` 全空、`docker images` SIZE 较改前记录值下降；`COPY --from=daemon` 各行零变化，backend/tests/test_daemon_dist.py 绿。

#### 场景：主路径

- Given 改前镜像 SIZE 已记录
- When SILLYSPEC_REFRESH 重建 + --force-recreate
- Then 全部验证点通过且体积下降

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：Dockerfile 静态改动，验收以 grep 源行 + 重建后容器内 which 全空为准
FR-02: 不适用：entrypoint 静态改动，验收以 grep + 容器正常启动（alembic→uvicorn）为准
FR-03: 不适用：compose 静态改动，验收以 docker compose config 解析通过为准
FR-04: 不适用：构建编排与容器运行时，验收以 test_daemon_dist 实跑 + 容器内实跑命令为准
