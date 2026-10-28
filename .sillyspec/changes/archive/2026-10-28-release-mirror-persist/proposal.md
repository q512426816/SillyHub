---
author: flow-machine-draft
created_at: 2026-10-28T01:51:50.883Z
---
# 提案书（Proposal）— 2026-10-28-release-mirror-persist

## 动机

任务原话转写：发布记录镜像目录迁持久化并补双skill互链
动机：生产「发布记录」数据源是 /tmp 下手工同步目录+软删工作区行的侥幸链——/tmp 一旦被系统清理或 list_records 将来补上软删过滤，62 条记录全灭；且 10-27 起部署走了本机版 skill 漏掉镜像同步步骤，最新 6 条页面不可见（当日已补同步）。本变更把数据源落到持久路径并让双 skill 分工互认，防复发。

成功标准：
- 服务器发布记录数据源目录迁出 /tmp 至持久路径（/opt/sillyhub/repos/multi-agent-platform），backend 容器经挂载可读，/deploy-records 可见全部记录（含 seq49），服务器重启后数据仍在
- sillyhub-docker-deploy skill 发布记录节增加指向 deploy-to-server 的互链（生产部署含镜像目录同步），deploy-to-server 的镜像路径同步更新为新持久路径，两 skill 分工口径互认
- 服务器侧 workspace 数据源行落为显式活跃行，不再依赖软删行

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 服务器发布记录数据源目录迁出 /tmp 至持久路径（/opt/sillyhub/repos/multi-agent-platform），backend 容器经挂载可读，/deploy-records 可见全部记录（含 seq49），服务器重启后数据仍在
2. sillyhub-docker-deploy skill 发布记录节增加指向 deploy-to-server 的互链（生产部署含镜像目录同步），deploy-to-server 的镜像路径同步更新为新持久路径，两 skill 分工口径互认
3. 服务器侧 workspace 数据源行落为显式活跃行，不再依赖软删行

## 成功标准（可验证）

1. 服务器发布记录数据源目录迁出 /tmp 至持久路径（/opt/sillyhub/repos/multi-agent-platform），backend 容器经挂载可读，/deploy-records 可见全部记录（含 seq49），服务器重启后数据仍在
2. sillyhub-docker-deploy skill 发布记录节增加指向 deploy-to-server 的互链（生产部署含镜像目录同步），deploy-to-server 的镜像路径同步更新为新持久路径，两 skill 分工口径互认
3. 服务器侧 workspace 数据源行落为显式活跃行，不再依赖软删行
