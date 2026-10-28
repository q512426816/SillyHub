---
author: flow-machine-draft
created_at: 2026-10-28T01:51:50.883Z
---
# 设计记录（Design Record）— 2026-10-28-release-mirror-persist

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：三步迁移消灭 /tmp 侥幸链——①服务器建持久目录 `/opt/sillyhub/repos/multi-agent-platform/docs/releases/` 并 cp -a 迁移既有 62 份记录；②改服务器 `/opt/sillyhub/deploy/deploy/.env` 的 `HOST_PROJECTS_DIR` 与 `HOST_PATH_PREFIX` 为 `/opt/sillyhub/repos`——compose backend 绑定挂载 `${HOST_PROJECTS_DIR:-...}:/host-projects`（deploy/docker-compose.yml:100）由该变量驱动，`docker compose up -d` 重建挂载，compose 文件零改动；③SQL 单行 UPDATE 软删工作区行「multi-agent-platform-镜像」：deleted_at 清空 + root_path 改指新路径。repo 侧只改两份 skill 文档：sillyhub-docker-deploy 发布记录节加互链、deploy-to-server 镜像路径与迁移注记更新。

选复用 HOST_PROJECTS_DIR 换源而非 compose 增设挂载的理由：生产机上该挂载的唯一消费者就是发布记录数据源（其余 workspace 路径在服务器本不可达、服务器无 daemon），改 env 即换源，本地开发 .env 是独立文件不受影响；新增 compose 挂载要动共享 compose 面且对本地语义无增益。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：无代码接口变化（零 src 改动）。运维契约变化两条：①生产镜像目录路径 `/tmp/sillyhub-repos/multi-agent-platform` → `/opt/sillyhub/repos/multi-agent-platform`（deploy-to-server skill 的 mkdir/scp 命令为唯一权威口径）；②服务器 .env `HOST_PROJECTS_DIR`/`HOST_PATH_PREFIX` 语义从「/tmp 临时镜像」改为「/opt/sillyhub/repos 持久仓」。workspace 行「multi-agent-platform-镜像」从软删转活跃，root_path 更新。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。同步是幂等 scp 全量覆盖，乱序以文件内容为准；迁移切换后 /tmp 旧目录不再是数据源（行已改指），不存在双源竞争。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：scp 重传与 backend 扫描并发时，单文件 read_text 由 OS 原子性兜底，最坏读到半文件落 invalid 条目（既有 _iter_files 容错），下次请求自愈；两会话同时 scp 同名文件后写者胜，与现状一致。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。compose up -d 重建挂载变更的服务期间秒级中断，与既有部署同形态；/opt 为磁盘持久路径，重启不丢；UPDATE 旧值（deleted_at=2026-10-14 07:50:29.831031+00、旧 root_path=/tmp/sillyhub-repos/multi-agent-platform）已留痕本文件与 requirements 场景，可逆。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。list_records 扫全部 workspace——其他工作区的用户机路径在服务器不可达仍返回空（不变）；本变更只改一行指向，不触其他工作区数据；本地开发栈用自己 .env（C:/ 前缀），互不影响。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是 SQL 直改生产库绕过应用层校验（API 取 token 不可行——bootstrap 密码已与实际不符，401）。对策：单行 UPDATE、新旧值留痕、改后立即容器视角核验；不做任何凭据重置。

放弃方案：
- A（compose 增设专用挂载 /srv/releases）：要动共享 compose 文件且本地语义无增益——放弃，改 env 换源零 compose 改动。
- B（走 API 建改工作区）：管理密码 401 取不到 token，重置凭据超出本变更范围且引入安全面动作——放弃，走 SQL 单行 UPDATE。
- C（/tmp 旧目录双写过渡）：双源并存违反单一数据源目标，/tmp 侥幸链正是本变更要消灭的对象——放弃，验证通过后一次性删除旧目录。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | .zcode/skills/sillyhub-docker-deploy/SKILL.md | 发布记录节加指向 deploy-to-server 的互链（生产部署含镜像目录同步） |
| 修改 | .zcode/skills/deploy-to-server/SKILL.md | 镜像目录路径 /tmp→/opt/sillyhub/repos 持久路径，mkdir/scp 命令与注记同步更新 |
