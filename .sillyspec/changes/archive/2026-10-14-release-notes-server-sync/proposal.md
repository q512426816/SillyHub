---
author: flow-machine-draft
created_at: 2026-10-14T07:11:17.875Z
---
# 提案书（Proposal）— 2026-10-14-release-notes-server-sync

## 动机

任务原话转写：发布记录数据源上服务器：deploy-to-server 部署流程增发布记录同步步骤（服务器只读镜像目录 + workspace 指向 + skill 文档化），让服务器平台页面展示每次部署的发布记录

成功标准：
- 服务器有固定目录承载 multi-agent-platform 的 docs/releases 镜像（容器可读，经 /tmp 挂载）
- workspace 行指向该目录且页面能列出记录（seq/状态/提交数/正文渲染数据齐）
- deploy-to-server skill 增「发布记录（每次部署必做）」节：写记录（引用 sillyhub-docker-deploy 契约）+ 部署后同步命令
- 本次热修部署（a176393cb）补写记录 #002 并同步到服务器验证全链

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 服务器有固定目录承载 multi-agent-platform 的 docs/releases 镜像（容器可读，经 /tmp 挂载）
2. workspace 行指向该目录且页面能列出记录（seq/状态/提交数/正文渲染数据齐）
3. deploy-to-server skill 增「发布记录（每次部署必做）」节：写记录（引用 sillyhub-docker-deploy 契约）+ 部署后同步命令
4. 本次热修部署（a176393cb）补写记录 #002 并同步到服务器验证全链

## 成功标准（可验证）

1. 服务器有固定目录承载 multi-agent-platform 的 docs/releases 镜像（容器可读，经 /tmp 挂载）
2. workspace 行指向该目录且页面能列出记录（seq/状态/提交数/正文渲染数据齐）
3. deploy-to-server skill 增「发布记录（每次部署必做）」节：写记录（引用 sillyhub-docker-deploy 契约）+ 部署后同步命令
4. 本次热修部署（a176393cb）补写记录 #002 并同步到服务器验证全链
