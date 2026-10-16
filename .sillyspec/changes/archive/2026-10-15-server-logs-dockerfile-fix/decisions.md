---
author: flow-machine-draft
created_at: 2026-10-16T03:48:25.918Z
---
# 决策记录（Decisions）— 2026-10-15-server-logs-dockerfile-fix

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：已部署的服务器若以 bind-mount 覆盖 /data（宿主目录属 root），镜像内 chown 不生效——预建目录会被挂载遮蔽，仍可能权限被拒；此时降级警告（修复②）会在容器日志里明示原因，按日志处置（宿主侧 chown 或配 log_dir 指向可写路径）。放弃的方案：改 docker-compose 加 volume 挂载日志目录——引入部署编排变更且服务器侧需手工迁移，超出「镜像自包含」修复边界（如需持久化日志到宿主，后续独立变更处理）。
