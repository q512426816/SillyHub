---
author: flow-machine-draft
created_at: 2026-10-08T03:10:03.162Z
---
# 任务注册表（Tasks）— 2026-10-08-backend-image-slim-no-claude

- [x] task-01: backend/Dockerfile：npm install 不装 claude-code；runtime 不再 COPY node/npm/node_modules 与 ln 二进制；sillyspec 包 package.json 焙为 /app/sillyspec-package.json
- [x] task-02: docker-entrypoint.sh：删 settings.json 生成块与 claude 插件同步块与 .claude skills 软链；保留 git config 与 /data 初始化
- [x] task-03: deploy/docker-compose.yml：backend 删 claude-data 卷挂载、NPM_CONFIG_CACHE env、CLAUDE_CODE_VERSION build arg
- [x] task-04: build-and-save.sh 版本回显改读 /app/sillyspec-package.json；本地重建后 health ok、技能 21 含 flow、manifest 正常、容器内无 node/claude/sillyspec 可执行、镜像体积较前显著下降（报告前后 SIZE）
- [x] task-05: /daemon/* 分发端点与 daemon bundle COPY 不受影响（test_daemon_dist 相关面绿）
