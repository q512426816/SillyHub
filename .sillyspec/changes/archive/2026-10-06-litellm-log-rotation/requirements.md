---
author: flow-machine-draft
created_at: 2026-10-05T17:16:19.525Z
---
# 需求规格（Requirements）— 2026-10-06-litellm-log-rotation

## 功能需求

> FR 由你撰写：每条 = `### FR-NN: 标题` + 一句带强度词的行为规定（必须=硬性；禁止=红线；
> SHOULD=建议须注理由；可以=可选）；边界情形加场景块 `#### 场景：名` + Given/When/Then 行。
> 标题行是成功标准锚（勿改写——收口做门柱对比）；正文与场景块归你。

### FR-01: deploy/docker-compose.yml 的 litellm 服务新增 logging json-file 有界配置（max-size + max-file）

- litellm 服务的容器日志**必须**经 json-file 驱动有界轮转（`max-size: "10m"` + `max-file: "3"`，总量上限 30m），**禁止**依赖 Docker 默认的 json-file 无上限行为——坏构建 crash-loop + restart:always 组合下日志会无上限膨胀打满低配机磁盘（2026-10-05-litellm-crashloop-quarantine 已识别的残留风险项）。

#### 场景：主路径

- Given：litellm 被显式拉起（`--profile litellm` 或点名 `up -d litellm`）且镜像仍为坏构建
- When：容器在 `restart: always` 下持续崩溃重启写日志
- Then：单个日志文件不超过 10m，旧文件最多保留 3 份，磁盘占用有界

### FR-02: 默认 up -d 启用集合不变：docker compose config --services 仍为 5 个核心服务，litellm/litellm-db 仍仅在 litellm profile

- 默认启用集合**必须**保持不变——不带 `--profile` 时 `config --services` 输出仍为 backend/frontend/minio/postgres/redis 共 5 个；litellm 与 litellm-db **必须**仅在 litellm profile 下出现，不因本变更回到默认栈。

#### 场景：主路径

- Given：本机 Docker 29.5.2 + Compose v5.1.3、deploy/.env 就绪
- When：`docker compose --env-file deploy/.env config --services`（无 profile）
- Then：输出 5 个核心服务且不含 litellm/litellm-db；同命令追加 `--profile litellm` 后输出 7 个（增 litellm、litellm-db）

### FR-03: 本机 docker compose config 渲染通过，且 litellm 服务除新增 logging 外无其它配置差异

- 改动后 compose **必须**在本机 Docker 29.5.2 + 真实 deploy/.env 下通过 `docker compose config` 渲染校验；litellm 服务相对基线**禁止**有 logging 块以外的任何配置差异（git diff 仅 9 行新增、单文件）。

#### 场景：主路径

- Given：工作区相对基线 c3130b9d3 的 compose 改动仅本变更
- When：`docker compose --profile litellm --env-file deploy/.env config` 渲染并对照 `git diff`
- Then：litellm 段渲染出 logging（driver json-file / max-size 10m / max-file 3），渲染无报错，diff 除该块（含注释）外无其它行

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: CLI 亲测/deploy/docker-compose.yml「--profile litellm config 渲染中 litellm 服务含 logging json-file / max-size 10m / max-file 3」
FR-02: CLI 亲测/deploy/docker-compose.yml「config --services 默认输出 5 个核心服务（backend/frontend/minio/postgres/redis），--profile litellm 后 7 个（增 litellm/litellm-db）」
FR-03: CLI 亲测/deploy/docker-compose.yml「config 渲染退出码 0；git diff 仅 deploy/docker-compose.yml 单文件 9 行新增（logging 块含注释），无其它改动」
