---
author: flow-machine-draft
created_at: 2026-10-24T04:19:36.124Z
---
# 任务注册表（Tasks）— 2026-10-24-backend-mem-limit-raise

- [x] task-01: deploy/docker-compose.yml backend mem_limit 从 1100m 提到 2500m，注释修正「服务器 1.6G」过时认知并记入实测 7.5G 与 OOM 证据
- [ ] task-02: 服务器同步新 compose 并 recreate backend 后 docker stats 显示 limit 约 2.44GiB，容器 healthy
