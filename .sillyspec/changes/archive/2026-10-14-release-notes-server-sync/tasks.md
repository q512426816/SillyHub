---
author: flow-machine-draft
created_at: 2026-10-14T07:11:17.875Z
---
# 任务注册表（Tasks）— 2026-10-14-release-notes-server-sync

- [x] task-01: 服务器有固定目录承载 multi-agent-platform 的 docs/releases 镜像（容器可读，经 /tmp 挂载）
- [x] task-02: workspace 行指向该目录且页面能列出记录（seq/状态/提交数/正文渲染数据齐）
- [x] task-03: deploy-to-server skill 增「发布记录（每次部署必做）」节：写记录（引用 sillyhub-docker-deploy 契约）+ 部署后同步命令
- [x] task-04: 本次热修部署（a176393cb）补写记录 #002 并同步到服务器验证全链
