---
author: flow-machine-draft
created_at: 2026-10-28T01:51:50.883Z
---
# 任务注册表（Tasks）— 2026-10-28-release-mirror-persist

- [x] task-01: 服务器建持久目录 /opt/sillyhub/repos/multi-agent-platform/docs/releases 并 cp -a 迁移既有 62 份记录；验证=宿主侧新目录计数 62 与旧目录一致、最新文件为 2026-10-28-001-ce842447d.md
- [x] task-02: 服务器 .env 的 HOST_PROJECTS_DIR/HOST_PATH_PREFIX 改 /opt/sillyhub/repos 并 docker compose up -d 重建引用挂载的服务；验证=容器内 ls /host-projects/multi-agent-platform/docs/releases 计 62 且五容器 healthy
- [x] task-03: SQL 单行 UPDATE 软删行「multi-agent-platform-镜像」→ deleted_at 清空 + root_path=/opt/sillyhub/repos/multi-agent-platform（旧值留痕进提交消息）；验证=SQL 查活跃行新路径 + 容器内 /host-projects/multi-agent-platform 可读
- [x] task-04: sillyhub-docker-deploy SKILL.md 发布记录节加指向 deploy-to-server 的互链（生产部署含镜像目录同步归属后者）；验证=grep 互链行在场
- [x] task-05: deploy-to-server SKILL.md 镜像目录路径更新为 /opt/sillyhub/repos/multi-agent-platform（mkdir/scp 命令+注记+2026-10-28 迁移说明）；验证=grep 无 /tmp/sillyhub-repos 现行口径残留
- [ ] task-06: 端到端核验（容器内数据源面 62 条含 seq49、workspace 活跃行指向新路径）+ 删除 /tmp/sillyhub-repos 旧目录消双源歧义；验证=容器视角计数与最新文件名，旧目录不存在
