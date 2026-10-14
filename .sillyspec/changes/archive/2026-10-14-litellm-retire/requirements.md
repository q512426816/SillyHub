---
author: flow-machine-draft
created_at: 2026-10-14T04:08:12.184Z
---
# 需求规格（Requirements）— 2026-10-14-litellm-retire

## 功能需求

### FR-01: prod compose 退役三块

- `deploy/docker-compose.yml` **必须**整体删除 `litellm` 服务块、`litellm-db` 服务块与 `litellm-db-data` 卷定义（含其专属注释）；删除后 `docker compose -f deploy/docker-compose.yml config -q` 校验通过，且 `config --services` 输出**禁止**再含 `litellm` / `litellm-db`；backend 等其余服务定义**禁止**变化。

#### 场景：主路径

- Given 修改后，When compose config 校验与 services 列举，Then 无 litellm 系条目、核心 5 服务不变。

### FR-02: dev compose 同款退役

- `deploy/docker-compose.dev.yml` **必须**删除 `litellm` / `litellm-db` 服务块、`litellm-db-data` 卷定义及 litellm 专属网络附接注释；删除后 `docker compose -f deploy/docker-compose.dev.yml config -q` 通过，核心服务（postgres/redis）不变。

#### 场景：主路径

- Given 修改后，When dev compose 校验，Then 通过且无 litellm 系条目。

### FR-03: 死配置文件清理

- `deploy/litellm-config.yaml`（仅 litellm 服务 bind mount 引用）**必须**随服务一并删除；全仓 grep **禁止**再出现对它的活引用（spike 历史文档提及不算活引用）。

#### 场景：主路径

- Given 删除后，When grep 全仓（排除 .sillyspec 归档与 docs 历史），Then 无 deploy/litellm-config.yaml 引用。

### FR-04: 本机容器下电、卷数据保留

- 本机四容器（`multi-agent-platform-litellm-1` / `multi-agent-platform-litellm-db-1` / `multi-agent-platform-dev-litellm-1` / `multi-agent-platform-dev-litellm-db-1`）**必须** stop+rm；两个 `litellm-db-data` 命名卷**必须保留**（数据可回滚）；backend/redis 等无关容器**禁止**触碰。

#### 场景：主路径

- Given 下电后，When `docker ps -a` 过滤 litellm，Then 零容器；`docker volume ls` 仍见两个 litellm-db-data 卷。

### FR-05: 坑记录闭坑归档

- `docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md` **必须**移入 `docs/sillyspec/finished/` 并补退役闭坑记录（拍板来源=用户 2026-10-14「彻底退役」裁决、本仓清理内容、服务器侧清理留待下次部署窗口）。

#### 场景：主路径

- Given 移动后，When 查看 finished/ 目录，Then 该文件在场且含退役闭坑段；活跃区不再有 litellm 坑文件。

### FR-06: 全量门禁

- compose 校验（FR-01/02 的 config 命令）**必须**作为本变更实测面通过；无单测面（纯配置/文档）记「不适用：理由」。

#### 场景：主路径

- Given 收口，When flow done 实测，Then compose config 两命令 EXIT=0。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：纯 compose 配置面，验收=docker compose config 校验（本变更实测命令）+ config --services 断言，无单测面
FR-02: 不适用：同 FR-01（dev compose 无单测面，验收=config 校验）
FR-03: 不适用：grep 全仓核验（人工/收口实测），无单测面
FR-04: 不适用：本机 Docker 运行态操作，验收=docker ps -a / volume ls 实况核对，无单测面
FR-05: 不适用：文档移动，验收=目录实况与内容核对
FR-06: 不适用：compose config 校验即实测门本体
