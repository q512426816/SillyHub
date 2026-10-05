---
author: flow-machine-draft
created_at: 2026-10-05T00:15:58.561Z
---
# 需求规格（Requirements）— 2026-10-05-litellm-crashloop-quarantine

## 功能需求

> FR 由你撰写：每条 = `### FR-NN: 标题` + 一句带强度词的行为规定（必须=硬性；禁止=红线；
> SHOULD=建议须注理由；可以=可选）；边界情形加场景块 `#### 场景：名` + Given/When/Then 行。
> 标题行是成功标准锚（勿改写——收口做门柱对比）；正文与场景块归你。

### FR-01: 默认（不带 --profile）docker compose up -d 不再拉起 litellm 与 litellm-db：docker compose config --services 默认输出不含两者，带 --profile litellm 后包含

- litellm 与 litellm-db 两服务**必须**声明 `profiles: ["litellm"]`，使默认 `docker compose up -d`（部署 skill 的标准收尾命令）的启用服务集合不含两者；带 `--profile litellm` 时两者必须回到启用集合（本机 Docker 29.5.2 scratch 实测语义：默认排除、显式激活包含）。

#### 场景：主路径

- Given：deploy/docker-compose.yml 中 litellm 与 litellm-db 均带 `profiles: ["litellm"]`
- When：`docker compose --env-file deploy/.env -f deploy/docker-compose.yml config --services`（无 profile）
- Then：输出不含 litellm、litellm-db；同命令加 `--profile litellm` 后两者均在列

### FR-02: 隔离可逆且零数据丢失：litellm-db-data 卷与两服务配置原样保留，--profile litellm（或显式 up -d litellm litellm-db，Compose 显式点名自动激活 profile）即可恢复拉起

- 隔离**必须**且仅通过 `profiles` 声明实现：**禁止**删除/改名服务与卷、禁止改动两服务既有镜像/环境/健康检查/依赖配置；`litellm-db-data` 卷定义原样保留（服务器已存在的卷数据不动）。

#### 场景：主路径

- Given：服务器 47.113.145.252 上 litellm 已 stop、litellm-db-data 卷有存量数据
- When：新 compose 应用后执行 `docker compose --profile litellm up -d litellm litellm-db`（或 `--profile litellm up -d`）
- Then：两服务按原配置参与拉起，卷名与数据不变

### FR-03: 其余服务（postgres/redis/minio/backend/frontend 等）的 config 渲染输出与改动前一致，仅新增 profiles 门，不改任何镜像/环境/依赖

- 本变更在 litellm/litellm-db 两服务块外**禁止**有任何语义改动；两服务块内除注释与 `profiles` 行外**禁止**其它改动。其余服务的 `docker compose config` 渲染结果必须与改动前逐字段一致。

#### 场景：主路径

- Given：改动前 `config` 渲染（含 --profile litellm 全量）已留存
- When：改动后同参数渲染并 diff
- Then：除两服务新增的 profiles 行（与因 profiles 而变化的归属字段）外无任何差异

### FR-04: compose 配置通过 docker compose config 校验无错误（本机 Docker 29.5.2 + deploy/.env 实测）

- 改动后的 compose **必须**在本机 Docker 29.5.2、真实 deploy/.env 下通过 `docker compose config` 校验（退出码 0，无 warning 级以上报错）。

#### 场景：主路径

- Given：本机 Docker 29.5.2 可用、deploy/.env 存在
- When：`docker compose --env-file deploy/.env -f deploy/docker-compose.yml config --quiet`
- Then：退出码 0

### FR-05: deploy/docker-compose.yml 注释与 docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md 新增 2026-10-05 段一致：profiles 门是临时隔离，选新 tag 的专门变更须一并移除

- compose 内注释与坑文档处置段**必须**互指且口径一致：profiles 门是坏构建在案期间的**临时**隔离；恢复默认栈=删除两处 profiles 行；处置 litellm 的专门变更（2026-10-05 矩阵证伪后分叉：①上游修复版 pin 新 tag，或②自研薄适配层落地后服务退役）**必须**把移除 profiles 门纳入其任务面。

#### 场景：主路径

- Given：坑文档位于 docs/sillyspec/ 活跃区，2026-10-05 段已写明 tag 路线死路与分叉待拍板
- When：阅读 compose 两处 profiles 行注释与坑文档 2026-10-05 两段处置记录
- Then：两处均写明「临时隔离、恢复/退役=专门变更处理 profiles 行」，分叉①②口径一致无分歧

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: CLI 亲测/deploy/docker-compose.yml「config --services 默认输出不含 litellm/litellm-db，--profile litellm 后包含」
FR-02: CLI 亲测/deploy/docker-compose.yml「--profile litellm config 渲染中两服务定义较改动前仅增 profiles 行，litellm-db-data 卷定义不变」
FR-03: CLI 亲测/deploy/docker-compose.yml「改动前后全量 config 渲染 diff：除两服务 profiles 行外其余服务逐字段一致」
FR-04: CLI 亲测/deploy/docker-compose.yml「docker compose --env-file deploy/.env config --quiet 退出码 0」
FR-05: 不适用：文档一致性为人工核对项（两文件同提交内互指，无自动化测试面）
