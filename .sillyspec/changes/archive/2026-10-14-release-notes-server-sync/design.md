---
author: flow-machine-draft
created_at: 2026-10-14T07:11:17.875Z
---
# 设计记录（Design Record）— 2026-10-14-release-notes-server-sync

## 做法概述

agent 部署时已把发布记录 md 写进本仓库 docs/releases/（既有契约），但服务器平台的 workspace root_path 是本机 Windows 路径、容器读不到（前变更 R-02 场景实锤）。本变更不推翻「写文件+只读」路线，只补数据源的物理可达性：在服务器挂载面建固定镜像目录 `/tmp/sillyhub-repos/multi-agent-platform/docs/releases/`，deploy-to-server skill 部署收尾时 scp 全量同步，DB 里 workspace「multi-agent-platform-镜像」指向它——后端零改动即可聚合展示。选镜像目录而非 API 上报，是 D-004 用户裁决的延续（最小面）；选 /tmp 而非持久卷，是接受「重启清空、部署自愈」的运维折中（skill 步骤每次全量重传）。

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

零代码接口变化：后端/前端/daemon 零改动，无新端点无新表（复用 2026-10-14-deploy-release-notes 的只读端点与解析器）。新增面只有两处运维契约：
1. **服务器镜像目录**（新约定）：`/tmp/sillyhub-repos/multi-agent-platform/docs/releases/`——deploy-to-server skill 的 scp 目标，后端经既有挂载 `/host-projects/...` 只读。
2. **skill 文档新增步骤**：`.zcode/skills/deploy-to-server/SKILL.md` 增「发布记录（每次部署必做）」节——写记录（引用 sillyhub-docker-deploy 契约）+ scp 全量同步命令；文件格式（frontmatter 8 字段）与既有契约逐字一致，零漂移。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：scp 全量覆盖式同步，无序性无影响——文件自含 seq/deployed_at，列表排序由后端按 deployed_at 倒序决定，与上传顺序无关。成立。
2. 并发写：scp 中途被读——最坏读到半截文件，yaml 解析失败走既有 invalid 容错（FR-04，不炸列表）；下次部署全量重传自愈。安全。
3. 切换/生命周期：/tmp 服务器重启可能被清——每次部署全量重传目录自愈（skill 步骤明示）；部署中断只影响当次记录缺失，无状态残留。安全。
4. 作用域：workspace「multi-agent-platform-镜像」是独立行，root_path 独占子目录，与既有 workspace（本机路径行）零交集；多仓扩展时每仓独立子目录（sillyhub-repos/<repo>/），不串台。安全。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- **最大风险**：镜像目录在 /tmp（服务器重启可能被清）→ 页面短暂空窗。接受：每次部署全量重传自愈；若清空窗口期需要看历史，scp 本地 docs/releases 即恢复。
- **放弃方案 A（API 上报+落库）**：需写端点+鉴权链+数据库表，实现面大；D-004 大变更时用户已裁决「写文件+只读」路线，本变更仅补数据源物理可达性，不推翻既有裁决。
- **放弃方案 B（服务器放完整 git 仓库）**：服务器 /opt/sillyhub 仓库存在但不在挂载面（/tmp），且引入服务器侧 git 拉取/凭证维护成本；镜像目录只需 scp 一个目录，最小面。
