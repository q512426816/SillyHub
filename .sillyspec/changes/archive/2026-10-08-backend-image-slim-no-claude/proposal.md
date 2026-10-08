---
author: flow-machine-draft
created_at: 2026-10-08T03:10:03.162Z
---
# 提案书（Proposal）— 2026-10-08-backend-image-slim-no-claude

## 动机

任务原话转写：backend 镜像瘦身——claude/sillyspec 二进制是 server-local 遗物（D-007 已删该模式、placement.py 注明 Daemon-Only、backend exec 只有 git：config.py COMMIT_SHA 回退 + diff_collector），执行全在宿主 daemon；镜像真正需要的是技能文件（manifest/bundle 分发枢纽）+ git + python。删 claude-code 安装、node/npm/npx/node_modules 进 runtime、entrypoint 的 .claude settings 生成与插件同步、compose 的 claude-data 挂载与 CLAUDE_CODE_VERSION/NPM_CONFIG_CACHE；技能仍从 sillyspec 包 COPY 并焙 package.json 版本件供回显
成功标准：
- backend/Dockerfile：npm install 不装 claude-code；runtime 不再 COPY node/npm/node_modules 与 ln 二进制；sillyspec 包 package.json 焙为 /app/sillyspec-package.json
- docker-entrypoint.sh：删 settings.json 生成块与 claude 插件同步块与 .claude skills 软链；保留 git config 与 /data 初始化
- deploy/docker-compose.yml：backend 删 claude-data 卷挂载、NPM_CONFIG_CACHE env、CLAUDE_CODE_VERSION build arg
- build-and-save.sh 版本回显改读 /app/sillyspec-package.json；本地重建后 health ok、技能 21 含 flow、manifest 正常、容器内无 node/claude/sillyspec 可执行、镜像体积较前显著下降（报告前后 SIZE）
- /daemon/* 分发端点与 daemon bundle COPY 不受影响（test_daemon_dist 相关面绿）

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. backend/Dockerfile：npm install 不装 claude-code；runtime 不再 COPY node/npm/node_modules 与 ln 二进制；sillyspec 包 package.json 焙为 /app/sillyspec-package.json
2. docker-entrypoint.sh：删 settings.json 生成块与 claude 插件同步块与 .claude skills 软链；保留 git config 与 /data 初始化
3. deploy/docker-compose.yml：backend 删 claude-data 卷挂载、NPM_CONFIG_CACHE env、CLAUDE_CODE_VERSION build arg
4. build-and-save.sh 版本回显改读 /app/sillyspec-package.json；本地重建后 health ok、技能 21 含 flow、manifest 正常、容器内无 node/claude/sillyspec 可执行、镜像体积较前显著下降（报告前后 SIZE）
5. /daemon/* 分发端点与 daemon bundle COPY 不受影响（test_daemon_dist 相关面绿）

## 成功标准（可验证）

1. backend/Dockerfile：npm install 不装 claude-code；runtime 不再 COPY node/npm/node_modules 与 ln 二进制；sillyspec 包 package.json 焙为 /app/sillyspec-package.json
2. docker-entrypoint.sh：删 settings.json 生成块与 claude 插件同步块与 .claude skills 软链；保留 git config 与 /data 初始化
3. deploy/docker-compose.yml：backend 删 claude-data 卷挂载、NPM_CONFIG_CACHE env、CLAUDE_CODE_VERSION build arg
4. build-and-save.sh 版本回显改读 /app/sillyspec-package.json；本地重建后 health ok、技能 21 含 flow、manifest 正常、容器内无 node/claude/sillyspec 可执行、镜像体积较前显著下降（报告前后 SIZE）
5. /daemon/* 分发端点与 daemon bundle COPY 不受影响（test_daemon_dist 相关面绿）
