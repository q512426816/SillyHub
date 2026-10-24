---
author: flow-machine-draft
created_at: 2026-10-24T04:19:36.124Z
---
# 需求规格（Requirements）— 2026-10-24-backend-mem-limit-raise

## 功能需求

### FR-01: deploy/docker-compose.yml backend mem_limit 从 1100m 提到 2500m，注释修正「服务器 1.6G」过时认知并记入实测 7.5G 与 OOM 证据

- deploy/docker-compose.yml 的 backend 服务 mem_limit 必须为 `2500m`（原 `1100m`）；该值上方的说明注释必须反映宿主内存实测 7.5G（替换「服务器 1.6G」过时表述），并记入 2026-10-16~10-23 共 25 次 cgroup OOM、被杀 worker 峰值 rss ~1.05GB 的证据要点，禁止保留与新限额矛盾的旧账面说明。

#### 场景：主路径

- Given 仓库 deploy/docker-compose.yml backend 服务 `mem_limit: 1100m`，注释含「服务器 1.6G：backend 1100 + 其他实际 ~270 + 系统 ~150 仍在总量内」的过时账面
- When 按本变更修改该文件
- Then backend `mem_limit` 为 `2500m`，注释为「宿主实测 7.5G + OOM 证据 + 新账面」的自洽表述，无 1.6G/1100m 残留矛盾

### FR-02: 服务器同步新 compose 并 recreate backend 后 docker stats 显示 limit 约 2.44GiB，容器 healthy

- 生产服务器（ubuntu@124.222.127.242）必须以本变更后的 docker-compose.yml 同步覆盖部署目录并 `docker compose up -d`（recreate backend）；完成后 `docker stats --no-stream` 显示的 backend MEM LIMIT 必须约为 2.44GiB（2500m），且 `docker ps` 中 backend 容器状态必须为 healthy。

#### 场景：主路径

- Given 服务器 backend 容器 MEM LIMIT 1.074GiB（1100m）运行中
- When scp 同步新 compose 到服务器部署目录并执行 `docker compose up -d`
- Then backend 容器被 recreate，`docker stats --no-stream` MEM LIMIT ≈2.44GiB，`docker ps` 状态含 (healthy)，服务恢复响应

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：纯部署配置值与注释改写（compose yaml），无运行时可执行测试面；验收以文件内容逐项核对（mem_limit 值 + 注释自洽无矛盾残留）。
FR-02: 不适用：部署验收面在生产服务器实测（docker stats / docker ps），无法在本仓测试 runner 表达；实测输出作为证据记入 ledger 与提交消息。
