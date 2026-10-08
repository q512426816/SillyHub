---
author: flow-machine-draft
created_at: 2026-10-08T02:38:28.292Z
---
# 任务注册表（Tasks）— 2026-10-08-backend-skills-follow-cli

- [x] task-01: backend/Dockerfile 技能 COPY 源从仓库快照(additional_contexts skills)改为 node-tools 阶段已装 sillyspec 包的 .claude/skills
- [x] task-02: npm 安装层引用 SILLYSPEC_REFRESH arg（时间戳爆破缓存），deploy/docker-compose.yml 传参、build-and-save.sh 每次打包自动导出新时间戳并回显镜像内 sillyspec 版本
- [x] task-03: deploy/.env 的 SILLYSPEC_VERSION 置空并注释为应急回滚口（默认走 npm latest）
- [x] task-04: 本地带 refresh 重建后容器内 sillyspec 版本=npm latest 且 /app/sillyspec-skills 与该版本技能数一致（21 个含 flow）、health ok
