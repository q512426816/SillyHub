---
author: flow-machine-draft
created_at: 2026-09-26T00:01:49.458Z
---
# 决策记录（Decisions）— 2026-09-26-deploy-eng-hardening

## D-001@v1: 风险与死路（design 槽4 收割）
- 决策：最大风险：compose 删 COMMIT_SHA 环境行后，若有人在服务器 shell export 空 COMMIT_SHA 再
  up --build，构建 arg 会拿到空串回退 unknown——但 build-and-save.sh 已在 export 前用 git rev-parse
  兜底（第 33 行 ${COMMIT_SHA:-$(git rev-parse --short HEAD)}），本地构建链路恒有值。次生：backup
  保留窗 4 个是拍脑袋值——按「每天数次部署×一周回溯」够用，磁盘紧可再调。放弃方案：①镜像里塞
  .git 目录供运行时探测——镜像膨胀且 build context 不含 .git；②gen 守卫用文件锁——并行会话
  锁文件本身又会成为新的竞态面。
