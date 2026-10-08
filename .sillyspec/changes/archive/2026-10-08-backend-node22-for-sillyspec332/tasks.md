---
author: flow-machine-draft
created_at: 2026-10-08T02:18:03.314Z
---
# 任务注册表（Tasks）— 2026-10-08-backend-node22-for-sillyspec332

- [x] task-01: backend/Dockerfile NODE_VERSION=22，构建注释说明 sillyspec >=3.30 对 node:sqlite 的依赖
- [x] task-02: 重建后容器内 sillyspec --version 为 3.32.0 且 flow 子命令不再报 node:sqlite 崩溃
- [x] task-03: 容器内 /app/sillyspec-skills 仍为 21 个技能、/api/health ok
- [x] task-04: 不改 apt 包集合与其它层语义
