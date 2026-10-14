---
author: flow-machine-draft
created_at: 2026-10-14T04:08:12.184Z
---
# 任务注册表（Tasks）— 2026-10-14-litellm-retire

- [x] task-01: deploy/docker-compose.yml 删 litellm、litellm-db 服务块与 litellm-db-data 卷定义，docker compose config 校验通过且 config --services 不再含 litellm 系
- [x] task-02: deploy/docker-compose.dev.yml 同款三块删除，config 校验通过
- [x] task-03: deploy/litellm-config.yaml 若确认仅 litellm 服务引用则一并删除
- [x] task-04: 本机四容器（prod/dev 栈 litellm、litellm-db）stop+rm，命名卷数据保留（可回滚）
- [x] task-05: docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md 移 finished/ 并补退役闭坑记录（服务器侧清理留待下次部署窗口）
