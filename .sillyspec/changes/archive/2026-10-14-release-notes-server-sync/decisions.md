---
author: flow-machine-draft
created_at: 2026-10-14T07:47:58.841Z
---
# 决策记录（Decisions）— 2026-10-14-release-notes-server-sync

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：- **最大风险**：镜像目录在 /tmp（服务器重启可能被清）→ 页面短暂空窗。接受：每次部署全量重传自愈；若清空窗口期需要看历史，scp 本地 docs/releases 即恢复。 - **放弃方案 A（API 上报+落库）**：需写端点+鉴权链+数据库表，实现面大；D-004 大变更时用户已裁决「写文件+只读」路线，本变更仅补数据源物理可达性，不推翻既有裁决。 - **放弃方案 B（服务器放完整 git 仓库）**：服务器 /opt/sillyhub 仓库存在但不在挂载面（/tmp），且引入服务器侧 git 拉取/凭证维护成本；镜像目录只需 scp 一个目录，最小面。
