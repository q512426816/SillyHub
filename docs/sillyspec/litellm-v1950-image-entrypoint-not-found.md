# litellm v1.95.0 镜像 entrypoint 找不到自身二进制（crash-loop 127）

- 发现日期：2026-10-02（阿里云服务器更新部署实测）
- 影响面：`deploy/docker-compose.yml` 的 Wave2 litellm 转换网关服务

## 现象

`docker compose up -d --build` 后 `multi-agent-platform-litellm-1` 无限重启：

```
litellm-1 | docker/prod_entrypoint.sh: exec: line 7: litellm: not found
```

退出码 127（command not found）。镜像架构核对无误（`ghcr.io/berriai/litellm:v1.95.0`
inspect 为 `amd64/linux`，宿主 x86_64）——非架构错配，是镜像内 PATH/二进制问题。

## 处置（2026-10-02 部署窗口）

`docker compose stop litellm litellm-db` 止住崩溃循环。核心栈不受影响：
平台当前 GLM/Anthropic 供应商走 `ANTHROPIC_BASE_URL` 直连（.env），不经 litellm；
OpenAI 型供应商经 litellm 的转换链路（admin API 注册 model）在该服务器尚未启用。

## 待办

- 调研 v1.95.0 官方镜像的正确用法（entrypoint 期望的 config 挂载路径 /
  是否需 `litellm --config /app/config.yaml` 显式命令 / 换 `litellm-database`
  变体镜像）——compose 注释称「config 形态以 spike-litellm-routing 实测定稿」，
  疑似 spike 结论与该镜像 tag 实际行为有漂移，需复测。
- 修复后 `docker compose start litellm litellm-db` 拉起（服务器 .env 已具备
  LITELLM_MASTER_KEY / LITELLM_DB_PASSWORD）。

## 关联

服务器：47.113.145.252 `/opt/sillyhub/deploy/deploy/`；本次部署细节见
`sillyhub-src` 服务器构建路径（docs/sillyspec/server-build-next-oom-lowmem.md）。

## 处置记录（2026-10-03）

**根因定性 + 仓侧修复**（multi-agent-platform 工作树，未提交）：

- **plain `litellm:v1.95.0` 是残缺构建**（[BerriAI/litellm #7649](https://github.com/BerriAI/litellm/issues/7649) 同族）：ghcr manifest API 核对该 tag 存在、Entrypoint/PATH 元数据正常（`/app/.venv/bin` 在 PATH），但层内容缺 litellm 二进制 → prod_entrypoint exec 127。非本仓配置问题。
- **本用法本就要求 database 变体**：`STORE_MODEL_IN_DB=True` + 外部 postgres 按官方口径需 `litellm-database` 镜像（prisma/DB 栈）——spike 假设与 deploy 实配的漂移点。
- **tag scheme 勘误**：`main-v` 前缀 ~v1.66 后已弃用（`main-v1.95.0` = 404），现行即 `vX.Y.Z`。

**修复（已被运行时证伪，见 2026-10-04 段）**：`deploy/docker-compose.yml` image 改
`ghcr.io/berriai/litellm-database:v1.95.0`（ghcr manifest API 实存性已核；版本号维持
gap-A 钉语义；注释留全证据链）。compose YAML 解析校验通过。

**遗留（需服务器窗口）**：本机 Docker 不可用（WSL 卡死见关联坑），运行时验证留待下次
部署窗口——`git 同步 → docker compose up -d litellm litellm-db`，healthcheck 过即闭环；
若 database 变体仍异常，降级方案为 pin 回 spike 实测过的具体 tag 并重跑 gap-A 矩阵。归档
（配置面已修，运行时验证属部署窗口例行）。

## 处置记录（2026-10-04，部署窗口实测）——database 变体修复被证伪

阿里云更新部署窗口（2026-10-04-knowledge-touch-plain-title 镜像上线）做了运行时验证：

- `litellm-database:v1.95.0`（镜像 ID fea74fc80170）**同族残缺**：容器内同样
  `prod_entrypoint.sh: exec: line 7: litellm: not found` 127 crash-loop——manifest 存在性
  核对 ≠ 层内容完整，v1.95.0 两个变体（plain / database）在 ghcr 上均为坏构建。
- 「pin 回 spike 实测过的 tag」不可行：spike（2026-08-08 gap-A）实测通过时的
  `litellm:v1.95.0` tag 内容已被 ghcr 覆盖（同名 tag、不同残缺内容），无处可 pin。
- 处置：`docker compose stop litellm` 止住循环（litellm-db 留用）；核心栈不受影响
  （GLM/Anthropic 走 `ANTHROPIC_BASE_URL` 直连，OpenAI 型经 litellm 链路在该服务器
  尚未启用）。compose 的 image 仍指 database 变体（相对 plain 至少是官方要求的正确
  变体，待新 tag 定稿后只改版本号）。

**待办（需专门变更）**：选新版本 tag（v1.95.1+ 或 stable 线，需核对 BerriAI/litellm
release notes 中 #7649 同族修复）→ 重跑 gap-A 实测矩阵（mode=chat + 流式 /v1/messages，
compose 注释的硬约束）→ pin 后 `docker compose up -d litellm litellm-db` 验证 healthcheck。
本文件移回活跃区（`docs/sillyspec/`）跟踪至上述闭环。

## 处置记录（2026-10-05）——「选新 tag 重跑 gap-A」路线被本地矩阵证伪

无 Docker 环境（WSL 卡死）下用 pip 装包 + mock OpenAI 上游搭了 gap-A 本地矩阵
（网关 4100 / mock 4101，断言 anthropic /v1/messages 走上游 /chat/completions 而非
/responses），对现可 pin 的全部候选实测：

| 候选 | 镜像 | pip 行为 | 结论 |
|---|---|---|---|
| v1.95.0（plain/database） | 双双坏构建（二进制缺失，服务器两轮实证） | anthropic→**/responses**（±`model_info.mode=chat` 均不改道） | 不可用 |
| v1.95.1（database） | tag 在（层结构全新构建，内容健康否未知） | 同上 **/responses**；`openai_like/` 前缀对该端点 Unmapped | gap-A 挂 |
| v1.96.0（database） | tag 在 | （compose 注释已实证）responses adapter 不认 mode=chat | gap-A 挂 |

**关键新事实**：pip 的 OpenAI 协议端点（/v1/chat/completions）路由**正确**（实测命中
mock /chat/completions）——泄漏只在 anthropic /v1/messages 转换层（1.95.x 已带 1.96
注记的 responses 桥行为；spike 2026-08-08 通过时的镜像内容已被 ghcr 同 tag 覆盖，语义
不可复现）。fastapi 需钉 <0.129（`get_flat_dependant` 私有 API 兼容窗，本地矩阵副产物）。

**结论**：不存在「健康镜像 + gap-A 通过」的 litellm tag 可 pin——待办的 tag 路线死路。
**决策分叉（需拍板，二选一）**：
① 继续外包 LiteLLM：跟踪上游 anthropic→chat 修复（issue 面），服务保持 stop（当前
   GLM/Anthropic 直连不受影响），修复版出后用本坑的本地矩阵复验再 pin；
② 重开 D-004/D-012（平台不实现转换）：anthropic→openai 兼容单模型直通是窄面需求
   （/v1/messages 流式 + 工具调用），自研薄适配层替代 litellm（减一个 SPOF + 坏构建面）。

compose 维持 `litellm-database:v1.95.0` pin（无论分叉如何都是当前正确变体）；镜像 pin
注释已补记本结论。本文件保持活跃跟踪至分叉拍板。

## 处置记录（2026-10-05，隔离加固）——profiles 门控移出默认 up -d

分叉拍板前，「服务器手动 stop + 注释提醒」是唯一防线，但两个部署 skill 的标准收尾
命令就是全量 `up -d`——下次常规部署必然把坏镜像重新拉进 crash-loop（restart:always
且 deploy/ 无日志轮转配置，1.6G 机日志无上限膨胀）。结构性加固（change
2026-10-05-litellm-crashloop-quarantine）：

- `deploy/docker-compose.yml` 的 litellm 与 litellm-db 各加 `profiles: ["litellm"]`，
  移出默认启用集合；两服务与 `litellm-db-data` 卷定义原样保留（零数据丢失）。
- 本机 Docker 29.5.2 + deploy/.env 实测：默认 `config --services`＝5 核心服务（不含
  litellm 系）；`--profile litellm` 或显式 `up -d litellm litellm-db` 恢复全部 7 个
  （Compose 显式点名自动激活 profile，dry-run 实证）；全量渲染 diff 仅两处 profiles 行。
- **移除条件（并入分叉拍板后的专门变更）**：①上游修复版 pin 新 tag → 删两处 profiles
  行恢复默认栈（NFR-03 always 语义随 profiles 一并恢复）；②自研薄适配层落地 →
  litellm 服务整体退役时一并带走（含 profiles 行）。
- 注：本机（非服务器）litellm-db 容器当前在跑——profiles 不触碰已存在容器，`up -d`
  不会停它，需要时手动 `docker compose stop litellm-db`。
