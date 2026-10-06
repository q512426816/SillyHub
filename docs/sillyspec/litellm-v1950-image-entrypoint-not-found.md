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

## 处置记录（2026-10-06）——opencode 供应商不再被本坑阻塞（直连绕开 LiteLLM）

用户报「平台供应商 opencode 路由有问题」。根因两层：

1. **平台侧（本坑）**：服务器 OpenCode Go 供应商行原配 `openai_chat`
   （base_url 还错拼成 go 端点 + chat/completions 全端点），整条链依赖被隔离停用的
   litellm → 必然全断。
2. **上游侧（opencode go 端点鉴权/路由口径，实测 2026-10-06）**：
   - go 端点**原生提供 Anthropic `/v1/messages`**（官方文档列 MiniMax/Qwen 系走它，
     实测 deepseek-v4.1-flash 等全部模型都能路由），流式 + thinking 块标准 Anthropic 格式；
   - 该端点**仅认 `x-api-key`**（`Authorization: Bearer` 恒 401 AuthError "Missing API key"）；
   - 无 `x-opencode-session` 头会拒（MissingSessionID），但 **Claude Code 原生 session 头被
     opencode 识别**（官方文档 + 本机 claude 2.1.216 真机 `-p` 会话实证，纯文本 + Read 工具
     调用往返全通），无需注入自定义头。

**处置（change 2026-10-06-opencode-go-direct-anthropic）**：opencode 供应商改走
anthropic 直连（与 GLM/DeepSeek/Kimi 同型）：服务器 DB 行
`api_format=anthropic / base_url=https://opencode.ai/zen/go / auth_field=ANTHROPIC_API_KEY /
model=deepseek-v4.1-flash（+4 角色槽同填）`；前端 `opencode_go` 预设同口径修正
（原照抄 cc-switch 的 ANTHROPIC_AUTH_TOKEN 配出来必 401——cc-switch 该条目自身有问题）。
opencode_zen_openai 预设（openai_chat）保留不动，其可用性仍绑本坑分叉拍板。

**对分叉的影响**：opencode 需求已不依赖 LiteLLM 复活，但其它 OpenAI 兼容上游（无原生
anthropic 端点的）仍被分叉卡着——①上游修复 vs ②自研薄适配 的拍板继续挂起，本文件保持活跃。

**追加（2026-10-06 下午，compose 同步教训）**：本次常规更新部署（load-and-up.sh 全量
`up -d`）把已隔离的 litellm 重新拉进 crash-loop——服务器 `/opt/sillyhub/deploy/deploy/
docker-compose.yml` 是 quarantine 提交（2026-10-05）之前的旧版（0 处 profiles 行），而
部署 skill 只传镜像不传 compose 文件。已手动 stop + 同步仓内 compose（config --services
实证默认集合 5 个、不含 litellm 系）。**教训：compose 结构性变更（profiles/端口/卷）合并后
必须随下次部署同步服务器 compose 文件**（scp deploy/docker-compose.yml），镜像同步 ≠ 配置
同步；必要时把 compose 同步并进 load-and-up.sh 收口清单。

## 处置记录（2026-10-07）——compose 同步缺口已固化修复（部署教训落地）

上节教训的「必要时」已落为固定动作：① `deploy-to-server` skill 的 scp 清单补上
`deploy/docker-compose.yml`（镜像同步 ≠ 配置同步的根因就在清单缺件）；②
`load-and-up.sh` 在 `up -d` 前打印本次启动服务集（`config --services`），配置漂移
（多出/缺少服务）部署时立见。bash -n / YAML 校验过。分叉拍板（①上游修复跟踪 vs
②自研薄适配）仍挂起，本文件保持活跃。

## 处置记录（2026-10-06 下午 ②）——opencode「selected model 不存在」终局根因：settings_config 毒覆盖链

opencode 会话残余报错（「There's an issue with the selected model (deepseek-v4.1-flash)」
+ 部分会话 SSL 报错）的最终根因不在网络也不在模型：**OpenCode Go 供应商行残留旧
`settings_config.env`**（`ANTHROPIC_BASE_URL` 指向 `/zen/go/v1/chat/completions` 全端点 +
无关 `sk-` key + mimo-v2.5 模型串，openai_chat 时代/导入残留）。daemon 注入器规则 7
（settings_config.env 最高优先级，D-007）把规则 0-6 的平台注入**全部覆盖**：
- Claude Code 实际打 `.../v1/chat/completions/v1/messages`（路径拼错）+ Bearer sk- →
  上游 404 → 报「selected model 不存在」；
- 上午 SSL 报错同源叠加（该 host 直连被 TLS 劫持的窗口）。

处置：`UPDATE llm_providers SET settings_config = NULL`（行 68b4b5b9）；清后平台 UI
**真实新会话**（OpenCode Go + deepseek-v4.1-flash，经本机 daemon + Clash 7897 代理）
发送「请只回复两个字：收到」→ 模型回复「收到」，第 1 轮已完成（usage ↑35,821 ↓164），
daemon 会话快照核对 settings_config=null / extra_env=HTTPS_PROXY / base_url / auth_field /
model 全部正确（change 2026-10-06-opencode-settings-config-poison）。

**教训：编辑供应商行数据时必须同步检查 settings_config——其 env 块优先级高于
base_url / auth_field / model 全部平台字段，残留即毒**。旧会话的 providerConfig 快照
含毒不回填：换供应商再切回、或直接新会话即愈。
