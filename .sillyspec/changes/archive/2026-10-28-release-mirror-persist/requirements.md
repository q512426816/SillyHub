---
author: flow-machine-draft
created_at: 2026-10-28T01:51:50.883Z
---
# 需求规格（Requirements）— 2026-10-28-release-mirror-persist

## 功能需求

### FR-01: 服务器发布记录数据源目录迁出 /tmp 至持久路径（/opt/sillyhub/repos/multi-agent-platform），backend 容器经挂载可读，/deploy-records 可见全部记录（含 seq49），服务器重启后数据仍在

- 迁移后服务器侧发布记录数据源必须位于持久路径 `/opt/sillyhub/repos/multi-agent-platform/docs/releases/`，禁止再以 /tmp 下目录作为数据源承载面。
- backend 容器必须能经 `/host-projects` 挂载读到该目录下全部记录文件；数据面必须包含既有全部 62 条记录（含 seq49 = `2026-10-28-001-ce842447d.md`）。
- 数据源目录必须落在重启不丢的磁盘路径（/opt/sillyhub 下），服务器重启后记录仍在，不依赖重传自愈。

#### 场景：迁移后数据面完整

- Given 服务器既有镜像目录 62 份记录（含 2026-10-28-001-ce842447d.md）
- When 完成目录迁移、挂载切换与数据源行改指后从 backend 容器内列 `/host-projects/multi-agent-platform/docs/releases/`
- Then 文件计数为 62 且按时间最新一份为 `2026-10-28-001-ce842447d.md`

#### 场景：重启持久性

- Given 数据源目录位于 /opt/sillyhub/repos/multi-agent-platform
- When 服务器重启后再次查看该目录
- Then 62 份记录文件仍在（/opt 为磁盘持久路径，非 /tmp 易失面）

### FR-02: sillyhub-docker-deploy skill 发布记录节增加指向 deploy-to-server 的互链（生产部署含镜像目录同步），deploy-to-server 的镜像路径同步更新为新持久路径，两 skill 分工口径互认

- sillyhub-docker-deploy SKILL.md 的「发布记录」节必须含指向 deploy-to-server skill 同名节的互链，写明生产部署的「同步服务器镜像目录」步骤归属后者；禁止让读者误以为本节覆盖生产部署收尾。
- deploy-to-server SKILL.md 的镜像目录路径必须更新为 `/opt/sillyhub/repos/multi-agent-platform`，mkdir/scp 命令与说明同步；/tmp 旧路径不得再以现行口径出现（仅可作废弃注记）。

#### 场景：主路径

- Given 两份 skill 文档
- When 在 sillyhub-docker-deploy 发布记录节查找生产部署指引、在 deploy-to-server 查找镜像目录路径
- Then 前者命中互链行（指明生产走 deploy-to-server），后者命令与说明均为 /opt/sillyhub/repos 新路径

### FR-03: 服务器侧 workspace 数据源行落为显式活跃行，不再依赖软删行

- 指向数据源目录的 workspace 行必须为活跃行（deleted_at 为空）且 root_path 指向 `/opt/sillyhub/repos/multi-agent-platform`；发布记录扫描不得依赖软删行的侥幸可见性。
- 改行前旧值（deleted_at 时间戳、旧 root_path）必须留痕于本变更，保证可回退。

#### 场景：主路径

- Given 数据库中软删行「multi-agent-platform-镜像」（root_path=/tmp/sillyhub-repos/multi-agent-platform，deleted_at=2026-10-14 07:50:29+00）
- When 执行单行 UPDATE（清 deleted_at、root_path 改指新持久路径）后查询该行
- Then 返回活跃行且 root_path 为新路径；backend 容器内对应改写路径 `/host-projects/multi-agent-platform` 可读

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：服务器目录/挂载为运维面而非本仓 src/test 代码，验证=宿主与容器双视角实物核验（task-01/02/06）
FR-02: 不适用：纯 skill 文档变更（视觉样式与纯配置/文档不写测试），验收=grep 在场核验（task-04/05）
FR-03: 不适用：生产 DB 行运维面（零 src 改动），验证=SQL 查询活跃行+容器改写路径实物核验（task-03）
