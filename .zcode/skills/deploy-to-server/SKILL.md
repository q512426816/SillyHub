---
name: deploy-to-server
description: 本地打包镜像→生产服务器（腾讯云轻量）部署；域名入口仍是阿里云 nginx + SSH 隧道。适合用户说"部署到服务器"、"远程部署"、"更新生产环境"、"打包传镜像"、"不在服务器构建"。区分更新部署（已有环境换镜像）和首次部署（服务器从零）。
---

# 远程服务器部署（本地打包 → 腾讯云生产服务器）

## 拓扑（2026-10-16 服务器迁移；同日已去隧道直连）

```
用户浏览器 → https://crrcdt.ppdmq.top
  → 阿里云 47.113.145.252 nginx（443/LE 证书）
  → 直连 http://124.222.127.242:3001|8001（腾讯轻量控制台防火墙已放行两端口）
  → 腾讯云轻量 124.222.127.242（整套栈：backend/frontend/postgres/redis/minio）
```

- 迁移当天先经 SSH 隧道过渡（轻量防火墙默认只开 22），用户在控制台放行 3001/8001 后
  已切直连并 `systemctl disable --now tencent-tunnel`。隧道 unit + 受限密钥保留作应急：
  若控制台把端口重新关掉，`systemctl enable --now tencent-tunnel` + 把 nginx upstream
  改回 `127.0.0.1` 即恢复服务。
- nginx 5 处 upstream 现指向 `124.222.127.242`（备份在阿里云 `/etc/nginx/backups/`）。
- **入口带宽瓶颈（2026-10-19 实测）**：阿里云入口机是经济型 `ecs.e-c1m1.large`，**公网出方向仅 ~1Mbps**
  ——全站用户流量挤这条小水管：页面 JS/CSS 拉取秒级、5MB daemon bundle 裸传 80s。腾讯云栈本身
  健康（本机 API 3ms、负载 0.15、带宽 5Mbps 未用）。已做的缓解：crrcdt 站点 nginx 开 gzip
  （JS/CSS/JSON/文本类，见「常见坑」末条）。彻底解法（待用户拍板）：入口迁腾讯云（需控制台
  放行 80/443 + DNS 切到 124.222.127.242，nginx 配置随迁）或升阿里云带宽。
- 阿里云旧栈：2026-10-16 下午起容器与镜像已彻底清理（含 litellm 遗物；清理前发现旧栈曾被
  误启动过一次，删除后此隐患消除），释放约 5G。**仅保留**：数据卷（数据冻结在
  2026-10-16 11:00 的快照）、compose 目录、nginx 配置备份、隧道应急件与
  `/root/migrate/` 迁移脚本日志。整机回滚需先从腾讯机取回镜像 tar（见「回滚」）。
- 阿里云入口机上还有别的项目容器（ppdmq-*），不要碰。
- 安全建议：轻量防火墙 3001/8001 规则来源最好限定为 `47.113.145.252`（只让阿里云 nginx
  访问），避免全网直打后端裸端口（后端有鉴权，但没必要暴露）。

## 目标

把当前仓库部署到腾讯云生产服务器，**本地构建镜像、传到服务器、服务器不构建直接起**——
避开服务器上前端 `next build` 的耗时。用 `docker save`/`load`，不需要镜像仓库（registry）。

先判断走哪条路径：

```bash
ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242 'docker compose ls 2>/dev/null; ls /opt/sillyhub/deploy/deploy/.env 2>/dev/null'
```

- 有 `multi-agent-platform` running + `.env` 存在 → **更新部署**
- 没有 → **首次部署**

## 服务器固定信息

- 生产机 SSH：`ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242`（ubuntu 用户，免密 sudo，
  已入 docker 组——docker 命令直接跑不用 sudo）
- 生产机规格：腾讯云轻量 lhins-2fh4az6u，4 核 / 8G / 60G SSD，5Mbps 带宽 / 500G 月流量
- compose 目录：`/opt/sillyhub/deploy/deploy/`（与老阿里云机同路径）
- 端口：前端 3001、后端 8001（宿主映射；仅本机监听面，公网被轻量防火墙拦）
- 架构：linux/amd64（和本地 Docker Desktop 构建出的 linux/amd64 一致，**无需交叉编译**）
- 入口机（阿里云 47.113.145.252，root，密钥 `~/.ssh/aliyun_deploy`）：只剩 nginx +
  `tencent-tunnel.service` 两个职责；隧道排障 `systemctl status tencent-tunnel`。

## 更新部署（日常用，最常用）

### 0. 部署并流校验（2026-10-16 互覆事故后强制）

**背景**：多会话共享同一台生产服务器，各会话从自己的 worktree/分支打包部署会**互相覆盖**——2026-10-16 实证：分叉分支部署静默回退 main 上当天已修复的 `/data/logs` 预建，页面日志再次不可见（生产跑起了一个不含主线修复的版本）。

**铁律：打包必须基于 main 主线**（主仓 `git rev-parse --abbrev-ref HEAD` 为 main，且应用目录无未提交改动）。`build-and-save.sh` 已内置两道闸门：
- 非 main 分支打包 → 直接退出（确需分支部署时 `ALLOW_NON_MAIN_DEPLOY=1` 显式放行并留痕）；
- `backend/frontend/sillyhub-daemon/deploy` 有未提交改动 → 退出（`ALLOW_DIRTY_DEPLOY=1` 放行）——镜像=工作区快照，脏工作区会把未合入代码带上生产。

**部署后必须核对版本**（见 §4）：health 的 `commit_sha` 与打包时打印的 commit 一致才算验收通过；不一致 = 刚被别人覆盖部署，按下方处置。

**被覆盖的识别与恢复**：
1. 服务器上 `curl -s http://127.0.0.1:8001/api/health` 拿 `commit_sha`；与打包 commit 不符即被覆盖（另可 `docker images | grep backend` 看 created 时间判断）；
2. 恢复：在 main 主线重新打包 → scp → load-and-up（**勿用分支版本"就地回滚"**——分叉分支缺主线修复，这正是事故本身；要保留对方分支的未合入交付，先合流再部署）；
3. 记录：按发布记录惯例写明"恢复部署（被 X 覆盖）"。

### 1. 本地打包（20 核，几分钟）

daemon 的 `src/` 改过才要重打 bundle（只改 install 脚本不影响 bundle JS，可跳过）：
```bash
cd sillyhub-daemon && pnpm bundle && cd ..   # 产出 build/bundle/{sillyhub-daemon.js,mcp-server.js}
```

打包（生产 API 地址覆盖前端 build-arg；本地 `.env` 的 `127.0.0.1` 是开发值，必须覆盖）：
```bash
PROD_API_URL=https://crrcdt.ppdmq.top bash deploy/scripts/build-and-save.sh
# 产出 deploy/images.tar.gz（backend + frontend 两镜像 gzip，约 300M）
# 输出会打印「打包源: 分支 main @ <short-sha>」——记下该 sha，部署后核对用
```

> `PROD_API_URL` 是生产环境前端浏览器访问后端的地址（取自服务器 `.env` 的 `NEXT_PUBLIC_API_BASE_URL`）。改了必须重新打包前端（`NEXT_PUBLIC_` 是 build 时固化到客户端的）。

### 2. 传到服务器

```bash
scp -i ~/.ssh/tencent_deploy deploy/images.tar.gz deploy/scripts/load-and-up.sh \
  ubuntu@124.222.127.242:/opt/sillyhub/deploy/deploy/
```

传完确认脚本是 LF（CRLF 会让服务器 bash 报 `bad interpreter`）：
```bash
ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242 "grep -c \$'\r' /opt/sillyhub/deploy/deploy/load-and-up.sh"
# 应返回 0
```

### 3. 服务器部署（不构建）

**稳妥做法（先备份旧镜像再 load，便于回滚）**：
```bash
ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242 'cd /opt/sillyhub/deploy/deploy && \
  STAMP=$(date +%Y%m%d-%H%M) && \
  docker tag multi-agent-platform-backend:latest  multi-agent-platform-backend:backup-$STAMP && \
  docker tag multi-agent-platform-frontend:latest multi-agent-platform-frontend:backup-$STAMP && \
  echo "✅ 备份 backup-$STAMP（回滚用）" && \
  gunzip -c images.tar.gz | docker load && \
  docker compose --env-file .env up -d'
```

**日常重复部署（load + up + 清 dangling + 删 tar 一条龙）**：
```bash
ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242 'cd /opt/sillyhub/deploy/deploy && bash load-and-up.sh'
```

### 4. 验证

```bash
ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242 'cd /opt/sillyhub/deploy/deploy && \
  docker compose ps && \
  curl -s http://127.0.0.1:8001/api/health && \
  docker exec multi-agent-platform-backend-1 sh -c "touch /data/spec-workspaces/.w && rm /data/spec-workspaces/.w && echo SPEC_MIRROR_WRITE_OK"'
```
- 5 个容器全 healthy（backend / frontend / postgres / redis / minio）
- health 返回 `{"status":"ok","db":"ok","redis":"ok",...}`
- **`commit_sha` 必须与打包时打印的短 sha 一致**（2026-10-16 互覆事故后强制）——不一致说明部署后已被其他会话覆盖，见 §0「被覆盖的识别与恢复」
- `SPEC_MIRROR_WRITE_OK` = spec 镜像目录对容器可写（缺了它变更文件树同步会全线 500，见「常见坑」属主项；迁移/搬数据后必查）

backend 镜像变更会自动跑 `alembic upgrade head`，看 logs 确认无报错：
```bash
ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242 'cd /opt/sillyhub/deploy/deploy && docker compose logs backend --tail=40'
```
- 看到 `Application startup complete` + `Uvicorn running on http://0.0.0.0:8000` = 成功
- 看到 alembic 报错 / 容器反复重启 = migration 问题，见下方「回滚」

**终局裁决（agent 日志归属清库脚本永不执行，2026-10-25 实证封存）**：

`reset_agent_log_attribution.py`（2026-09-13 部署裁决从迁移链抽出的一次性脚本，原时序「CLI 升级后、重推开始前跑一次」）**窗口已永久关闭，永不执行 --apply**。2026-10-25 生产库直查实证（腾讯机 platform 库，只读）：

- 重推/新代归属自 **2026-09-14 周起全面运转**：1059 行 platform_agent_logs 100% 有归属（新版 daemon own-only 推送所写），897 个新代 tool_report 会话活跃，change_session_links 最新一条 2026-10-25 当天——apply = 摧毁 6 周正确数据；
- 脚本设计要清的旧错配残留只剩 **6 行日志 + 1 个旧会话 + 2 条旧链接**（09-07 周），零功能影响，不值得动生产数据；若未来确需清理，按此残留面数字另开变更做时间窗限定版，勿跑全表脚本；
- 脚本 dry-run 计数 1274/898/709/280 是**全表行数**（DML 无 WHERE），不是「待清的错误数据量」——勿被大数字误导。

脚本本体与 docstring 保留作历史设计事实（`.sillyspec/docs/backend/modules/migrations.md` 20260912050000 段）；`.sillyspec/changes/archive/2026-10-25-reset-agent-log-adjudication/` 存完整裁决推导。

**若本次动了 daemon bundle 或 install 脚本，再验 daemon 分发端点**（公网经 nginx 与后端容器
必须一致，不一致 = nginx 在用静态旧副本，见下方「nginx 与 daemon 分发」）：
```bash
ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242 '
  curl -s -H "Cache-Control: no-cache" https://<域名>/daemon/latest.json; echo
  curl -s http://127.0.0.1:8001/daemon/latest.json; echo'
```

## 发布记录（每次部署必做，成功失败都写）

部署收尾前两步：**写记录 + 同步服务器**。平台「发布记录」菜单（/deploy-records）的数据源
是服务器上的只读镜像目录，漏同步 = 服务器页面看不到本次部署。

### 1. 写记录 md（契约与 sillyhub-docker-deploy skill 的「发布记录」节完全一致）

> ✅ **推荐用生成器**（2026-10-28-release-record-generator 起）：
> `bash deploy/scripts/gen-release-record.sh --summary "<一句概括>"`
> ——seq/锚点/文件名/frontmatter 成对标记全自动，产出即合规，输出末尾自带防漏指引；
> `--validate` 可扫历史坏件。下方手工口径保留为备选（生成器不可用时）。

取锚点：`commit_from` 取 `GET https://<域名>/api/deploy-records`（需登录 token）最近一条的
`commit_to`（不可达则看本地 `docs/releases/` 最大日期记录）；**`seq` 一律取号器**
`bash deploy/scripts/next-release-seq.sh`（全局最大 frontmatter seq + 1，2026-10-18 修
「seq 经常错」后单一取号源——勿按文件名日期段/当天序号/API 最近一条 +1 取号：文件名 NNN
是「当天第几次」跨天重置，API 最近一条会传染历史错值；frontmatter `seq` 是全局部署序号，
前端徽标 #NNN 用它）。提交范围
`git log <from>..HEAD`，按 🆕新增/🔧修复/⚡优化 分组规整成中文总结，写
`docs/releases/YYYY-MM-DD-<三位序号>-<HEAD短SHA>.md`（文件名 NNN=当天序号从 001 起；
frontmatter 8 字段 + 正文；失败部署也写 status: failed）。模板照 sillyhub-docker-deploy
SKILL.md，记录随代码一起 commit 推送。

### 2. 同步到服务器镜像目录（本 skill 专属步骤）

服务器平台经 `/opt/sillyhub/repos`→`/host-projects` 挂载读记录，镜像目录固定为
`/opt/sillyhub/repos/multi-agent-platform/docs/releases/`（workspace
「multi-agent-platform-镜像」为活跃行指向它）——**2026-10-28 起从 /tmp 迁至该持久路径**
（脱离 /tmp 重启即失的侥幸链，变更 2026-10-28-release-mirror-persist；旧 /tmp 目录已删除）：

```bash
ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242 \
  'mkdir -p /opt/sillyhub/repos/multi-agent-platform/docs/releases'
scp -i ~/.ssh/tencent_deploy docs/releases/*.md \
  ubuntu@124.222.127.242:/opt/sillyhub/repos/multi-agent-platform/docs/releases/
```

> 挂载由服务器 `/opt/sillyhub/deploy/deploy/.env` 的 `HOST_PROJECTS_DIR`/`HOST_PATH_PREFIX`
> （=/opt/sillyhub/repos）驱动，compose 侧 `${HOST_PROJECTS_DIR}:/host-projects`，改路径须两处同步。
> 平台上另有 workspace 记录的是本机路径（读不到），「multi-agent-platform-镜像」才是服务器
> 侧发布记录数据源；其它仓库要用同款能力时照抄：mkdir + scp + 建一条指向该目录的 workspace。

## 回滚

**镜像级回滚（日常，只回退版本）**——在腾讯云生产机上：
```bash
ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242 'cd /opt/sillyhub/deploy/deploy && \
  docker tag multi-agent-platform-backend:backup-<时间>  multi-agent-platform-backend:latest && \
  docker tag multi-agent-platform-frontend:backup-<时间> multi-agent-platform-frontend:latest && \
  docker compose --env-file .env up -d'
```
（`<时间>` 用 `docker images | grep backup` 查。）

**整机级回滚（迁回阿里云旧栈，数据是 2026-10-16 11:00 冻结点，会丢其后新数据）**：
2026-10-16 下午旧栈容器/镜像已清理，先取回镜像 tar（腾讯机 staging 观察期内保留；
阿里云机 `tencent_push` 临时密钥已删，本机中转最省事，或临时加回一个可登录密钥走服务器直传）：
```bash
# 1) 本机中转取回镜像 tar
ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242 'cat /home/ubuntu/migrate/staging/images.tar.gz' > /tmp/images.tar.gz
scp -i ~/.ssh/aliyun_deploy /tmp/images.tar.gz root@47.113.145.252:/root/migrate/
# 2) 阿里云：load → 起旧栈接管 8001/3001 → upstream 改回本机 → reload（顺序别反，避免 502 窗口）
ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252 '
  gunzip -c /root/migrate/images.tar.gz | docker load && \
  cd /opt/sillyhub/deploy/deploy && docker compose --env-file .env up -d && \
  sed -i "s#proxy_pass http://124.222.127.242:#proxy_pass http://127.0.0.1:#g" /etc/nginx/sites-enabled/crrcdt && \
  nginx -t && systemctl reload nginx'
```
（旧栈数据卷仍在阿里云 = 11:00 冻结点；后端/前端镜像只能从该 tar 恢复。）

## 首次部署（服务器从零）

### 1. 服务器装 Docker（国内机，apt 源用阿里云镜像）
```bash
ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242 '
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://mirrors.aliyun.com/docker-ce/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker && sudo usermod -aG docker ubuntu && docker compose version'
```
> 实测坑（2026-10-16 腾讯轻量）：`curl https://get.docker.com` 直连被重置，get-docker.sh
> 下不来；必须走上面 apt 源方式。装完 `usermod -aG docker` 后要重开 ssh 会话才免 sudo。

### 2. 建目录、放部署文件
```bash
ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242 'sudo mkdir -p /opt/sillyhub/deploy/deploy'
scp -r -i ~/.ssh/tencent_deploy deploy/docker-compose.yml deploy/.env.example deploy/scripts \
  ubuntu@124.222.127.242:/opt/sillyhub/deploy/deploy/
```

### 3. 配 .env（生产值）
```bash
ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242 'cd /opt/sillyhub/deploy/deploy && cp .env.example .env'
# 本地生成密钥：
python -c "import secrets; print('SECRET_KEY='+secrets.token_urlsafe(32)); print('SILLYSPEC_MASTER_KEY=v1:'+secrets.token_hex(32))"
# SSH 进去填（或本地编辑后 scp 覆盖）：
ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242 'vi /opt/sillyhub/deploy/deploy/.env'
```

必填生产值（**不要把真实 token/密码写进 skill 或提交**）：
```env
BACKEND_PORT=8001
FRONTEND_PORT=3001
SECRET_KEY=<随机48字符>
SILLYSPEC_MASTER_KEY=v1:<64位hex>   # crypto.py 要求 hex（token_hex），不是 base64；写成 token_urlsafe 会让 /api/llm-providers 等解密端点 500（bytes.fromhex 失败）
ANTHROPIC_AUTH_TOKEN=<真实token>
NEXT_PUBLIC_API_BASE_URL=http://192.168.0.143:8001   # 生产前端访问后端地址，或公网域名
INTERNAL_API_BASE_URL=http://backend:8000
HOST_PATH_PREFIX=/tmp
CORS_ALLOWED_ORIGINS=["http://localhost:3001","http://192.168.0.143:3001"]
PLATFORM_BOOTSTRAP_ADMIN_EMAIL=admin@sillyhub.local
PLATFORM_BOOTSTRAP_ADMIN_PASSWORD=<强密码>
```

### 4. 起服务

**推荐：本地打包传镜像**（和「更新部署」1-3 步完全一样，服务器不构建）。首次因为没有"旧 latest"可备份，跳过备份直接 load + up。

备选：服务器直接构建（需服务器上有完整源码 + `sillyhub-daemon/build/bundle/`）：
```bash
ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242 'cd /opt/sillyhub/deploy/deploy && \
  export COMMIT_SHA=$(cd /opt/sillyhub && git rev-parse --short HEAD 2>/dev/null || echo local) && \
  docker compose --env-file .env up --build -d'
```

### 5. 验证 + 初始化

同「更新部署」第 4 步。首次额外建 workspace（`root_path` 落在 compose 挂载目录）：
```bash
TOKEN=$(ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242 'curl -fsS -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@sillyhub.local\",\"password\":\"<密码>\"}" \
  http://127.0.0.1:8001/api/auth/login' | jq -r .access_token)
```
> 账号按 `deploy/.env` 的 `PLATFORM_BOOTSTRAP_ADMIN_EMAIL` / `PLATFORM_BOOTSTRAP_ADMIN_PASSWORD`（部署前务必改为强口令）。登录用 username 非 email（见 memory `login-by-username-not-email`）。

## nginx 路由（/daemon/* 与 /mcp 必须走后端）

> 2026-10-16 迁移后：这层 nginx 仍在**阿里云入口机**上，upstream 已指向
> `http://124.222.127.242:8001|3001`（当日上午短暂走 SSH 隧道过渡，控制台放行端口后
> 已切直连）。本节 location 调优（SSE/WS/410 特例）全部继续生效；
> 动 nginx 的操作也全部仍在阿里云机上做。

对外域名（如 `crrcdt.ppdmq.top`）前面有一层宿主机 nginx 反代，默认只把 `/api/` 与
`/daemon/` 代理到后端，其余走前端 Next.js——**`/mcp` 不加 location 会落到前端**：
MCP client `POST /mcp/` 收到 Next.js 的 308 去尾斜杠重定向 → HTML，表现为「远端未暴露
MCP gateway」（2026-09-10 spike P0-1 实测）。规范接入端点是 `https://<域名>/mcp/`
（带尾斜杠，MCP client 的 POST 不跟随重定向）。

### /daemon/*（禁止静态 alias）

**`/daemon/` 下所有文件
（install.sh / install.ps1 / latest.json / *.js bundle）都必须由后端 dist_router 从镜像
`/app/daemon-dist/` 吐最新版**，绝不能让 nginx 用 `alias` 指向宿主机某个手动维护的静态目录
（如 `/var/www/sillyhub/daemon/`）——那种静态副本**不会随后端镜像更新**，会和服务端脱节，
踩过的坑（2026-08-26）：

- 静态 `install.ps1` 是旧版、无 UTF-8 BOM、`{{SERVER_URL}}` 占位未替换 → 用户 `irm` 下载后
  WinPS 5.1 按 GBK 误读中文 → 解析报错，且 server_url 没注入根本装不上。
- 静态 `sillyhub-daemon.js` / `latest.json` 是旧版（bundle 0.1.0 / latest `fd0314c`）→
  用户装到旧版 daemon，提示版本对不上。

**正确配置**（`/etc/nginx/sites-enabled/<server>`）：整个 `/daemon/` 代理到后端，别用 alias：

```nginx
# Daemon 分发文件统一走后端 dist_router（镜像 /app/daemon-dist/ 吐最新版）。
# 禁止 alias 到宿主机静态目录——静态副本不随镜像更新会脱节（见 SKILL「nginx 与 daemon 分发」）。
location /daemon/ {
    proxy_pass http://124.222.127.242:8001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
}
```

### /mcp（对外 MCP gateway，2026-09-10 起必须配）

后端在 `/mcp/`（FastMCP streamable HTTP，尾斜杠必需）挂了对外 MCP gateway。nginx 必须把
`/mcp` 前缀代理到后端，并关 buffering + 拉长 read timeout（streamable HTTP 的 GET SSE
长连接会被默认 60s read timeout 掐断）：

```nginx
# MCP gateway（规范端点 /mcp/ 带尾斜杠）。POST 不跟随重定向，务必带尾斜杠访问。
# SSE 长连接需要 buffering off + 长 read timeout（对齐 /api/daemon/ws 的 3600s）。
location /mcp {
    proxy_pass http://124.222.127.242:8001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

**验证**（公网无 token 打 initialize，401 JSON 即通；308/HTML/404 = 没路由到后端）：

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<域名>/mcp/ \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'
# 预期 401，body 是 {"code":"HTTP_401_MCP_TOKEN_MISSING",...}
```

另：后端 mcp-tokens 签发响应会下发 `gateway_url`（与 token 成对）。它的 scheme 从
`X-Forwarded-Proto` 推导（上面配置已带）；若部署有多入口 / 转发头不可信，在 compose
`.env` 里配 `MCP_GATEWAY_PUBLIC_BASE_URL=https://<域名>` 显式钉死。

### /mcp 与 /daemon/ 改 nginx 的操作纪律

- 改前备份用 `cp <conf> /etc/nginx/backups/<conf>.bak.$(date +%Y%m%d-%H%M%S)`——
  **备份绝不能留在 `sites-enabled/` 里**：nginx include 该目录全部文件，`.bak` 里的
  重复 `default_server` 会直接 `nginx -t` 失败（2026-09-10 实测踩坑）。
- 改后 `nginx -t` 通过再 `systemctl reload nginx`（reload 无中断）。
- 小 JSON 易被缓存，验证时加 `-H "Cache-Control: no-cache"` 或换 query 串。

**部署/排障时怎么发现脱节**：对比「公网经 nginx」与「后端容器直出」是否一致——

```bash
ssh -i ~/.ssh/tencent_deploy ubuntu@124.222.127.242 '
  echo "— 公网 latest.json —"; curl -s -H "Cache-Control: no-cache" https://<域名>/daemon/latest.json; echo
  echo "— 后端 latest.json —"; curl -s http://127.0.0.1:8001/daemon/latest.json; echo
  echo "— 公网 bundle 版本 —"; curl -s https://<域名>/daemon/latest/sillyhub-daemon.js | grep -oa "0\.1\.[0-9]*" | sort -u
  echo "— 容器 bundle 版本 —"; docker exec multi-agent-platform-backend-1 grep -oa "0\.1\.[0-9]*" /app/daemon-dist/sillyhub-daemon.js | sort -u'
```

- 两边 version / bundle 版本号**必须一致**；不一致 = nginx 在用静态旧副本，按上面改成 proxy。
- `install.ps1` 额外看响应头：公网应是 `content-type: application/x-powershell; charset=utf-8`
  且 body 前 3 字节是 `ef bb bf`（BOM）；若是 `application/octet-stream` 无 charset → 仍在走静态。
- 改 nginx 前先备份（`cp <conf> <conf>.bak.$(date +%Y%m%d-%H%M%S)`），改后 `nginx -t` 通过再
  `systemctl reload nginx`（reload 无中断）。注意 `latest.json` 这类小 JSON 易被本地/CDN 缓存，
  验证时加 `-H "Cache-Control: no-cache"` 或换 query 串。

## 常见坑

- **活跃 compose 目录是 `/opt/sillyhub/deploy/deploy/`**（双层 deploy；腾讯云机上只有这一层，路径沿用老服务器保持一致），scp 和 ssh 都进深层目录。
- **腾讯轻量防火墙默认只开 22**（2026-10-16 实测）：控制台云层拦 80/443/3001/8001（服务器 ufw 是关的、机器上改不了），只能用户在腾讯控制台开。现已放行 3001/8001（nginx 直连）；若被重新关掉，应急恢复 = 阿里云 `systemctl enable --now tencent-tunnel` + upstream 改回 `127.0.0.1`（隧道 unit 与受限密钥保留未删）。
- **跨公网明文提示**：阿里云 nginx → `124.222.127.242` 这段是公网 HTTP（内网工具可接受）；要加密可退回隧道方案（加密但单流）或给腾讯机挂自签 TLS。轻量防火墙规则来源限定 `47.113.145.252` 可显著收窄暴露面。
- **域名突然 502/变旧数据时**：先 `systemctl status nginx`，再从阿里云 `curl -m 5 http://124.222.127.242:8001/api/health` 测直连（超时=轻量防火墙被关，走隧道应急）。阿里云旧栈容器/镜像已删（2026-10-16 下午），不存在旧栈被误起的风险。
- **远程 pkill -f 自杀坑**（2026-10-16 实测）：ssh 进去 `pkill -f "xxx"`，模式串会匹配到自己这条 ssh 会话的命令行把自己杀掉（exit 255 无输出）；用括号技巧 `pkill -f "[x]xx"` 或先 pgrep 拿 PID 再 kill。
- **PROD_API_URL 必须覆盖**：本地 `deploy/.env` 的 `NEXT_PUBLIC_API_BASE_URL=127.0.0.1:8001` 是开发值，直接打包给生产，浏览器会连用户自己机器。用 `PROD_API_URL=生产地址` 覆盖（环境变量 > `.env`）。
- **.sh 必须 LF**：`.gitattributes` 已强制 `*.sh eol=lf`，scp 前确认 `grep \r = 0`，否则服务器 `bash\r: bad interpreter`。
- **backend Dockerfile apt 源用清华 tuna**：`mirrors.aliyun.com` 的 debian trixie Packages 索引缺失会让 backend build 卡死（2026-07-17 已改 tuna）。
- **磁盘**：60G 盘（腾讯云）。`load-and-up.sh` 自动 `image prune -f` + 删 tar。但 `backup-<时间>` tag 会累积，定期手动清：`docker images | grep backup` → `docker rmi <旧backup>`。
- **内存与 OOM 排障（2026-10-16-backend-mem-polling）**：容器配额总和须 ≤1.85G（backend 1100m+postgres 256m+frontend 300m+minio 128m+redis 64m，见 compose）。backend 有嵌入子进程（闲置自灭）与 oom_score_adj 保护设计（注意：compose 服务级 oom_score_adj 键被部分 compose 版本忽略——`docker inspect ... OomScoreAdj` 复核）。若再见 OOM 强杀，先 `dmesg -T | grep 'Killed process'` 判被杀的是主进程还是嵌入子进程。建议 sysctl `vm.swappiness=10`（默认 60 在小内存机过早换页放大卡顿；`sysctl -w` + 持久化 /etc/sysctl.d/99-swappiness.conf，不入库；腾讯 8G 机优先级低）。

- **commit_sha=unknown**：health 端点这个字段恒 `unknown` 是既有问题（compose 运行时 `COMMIT_SHA` 覆盖镜像 build 值），不影响功能，见 memory `compose-commit-sha-runtime-override`。
- **backend 变更触发 alembic**：load + up 后 backend 启动跑 `alembic upgrade head`。migration 链断裂会 crash-loop，看 logs 诊断；项目未上线，可 `docker compose down -v` 重置 DB（先确认数据可丢）。
- **清库迁移已改 no-op（2026-09-13 部署裁决）**：20260912050000 的破坏性清库 DML **不随** `alembic upgrade head` 自动执行（旧逻辑会在 CLI 升级前自动清库、清空白做；且迁移链重放会把已重建的正确数据再清一遍）。原定手动执行的 `backend/scripts/reset_agent_log_attribution.py` 已于 2026-10-25 终局裁决**永不执行**（重推窗口 2026-09-14 已关，详见「更新部署 §4」的终局裁决段）。
- **daemon bundle**：backend 镜像依赖 `sillyhub-daemon/build/bundle/`。daemon 的 `src/` 改过必须 `pnpm bundle` 再打包；只改 `scripts/install.*` 不影响 bundle JS（随 rebuild 自动 COPY 最新源）。
- **spec 镜像目录属主必须跟容器用户（2026-10-16 迁移实锤，变更文件树同步全线 500 的根因）**：
  `/data/spec-workspaces`（`SPEC_DATA_HOST_DIR`，宿主 bind mount → 容器同路径）的**工作区树必须属
  `999:999`**（容器内 `app` 用户 uid/gid=999；宿主上 uid 999 的属名显示为 `dnsmasq`/`systemd-journal`）。
  迁移/rsync/scp 搬家后若属主变成 `ubuntu`（或任何非 999）且权限 755，后端写落盘即
  `PermissionError: [Errno 13]` → `POST /api/changes/-/spec-sync` 恒 500 → CLI 端症状为
  「同步请求失败 HTTP 500（文件树本次未同步，下次自动重试）」无限重试、变更详情页文件树永远空。
  修复：`sudo chown -R 999:999 /data/spec-workspaces`（顶层目录保持 777 供容器新建 workspace 树）；
  验证：进容器 `touch` 某个已有工作区树的 `changes/.w` 不报 Permission denied。
  老阿里云机实证属主就是 999:999——每次迁移/搬数据后都要对齐（已加进「更新部署 §4 验证」探针）。
- **不要碰 ppdmq-\***：服务器另有 `ppdmq-app/redis/mysql` 是别的项目，部署只动 `multi-agent-platform-*` 容器。
- **容器端口用 127.0.0.1**：本机 curl 验证服务器映射端口用 `127.0.0.1`（在服务器上 ssh 内执行），不要用 `localhost`（IPv6 解析问题）。
- **`/daemon/` 别让 nginx 静态 alias**：宿主机 `/var/www/sillyhub/daemon/` 这类静态副本不随镜像更新，会吐旧 bundle/旧 install.ps1（无 BOM、`{{SERVER_URL}}` 未替换）。整段 `location /daemon/` 必须 `proxy_pass` 到后端。排障/部署后对比公网与后端 latest.json 版本是否一致。详见上方「nginx 路由」。
- **`/mcp` 必须显式加 nginx location**：不配会落到前端 Next.js（308 → HTML），表现为远端 MCP gateway 未暴露；SSE 长连接还需 `proxy_buffering off` + 长 read timeout。详见上方「/mcp」节。
- **nginx 备份别留在 `sites-enabled/`**：nginx include 目录内全部文件，`.bak` 里的重复 `default_server` 会让 `nginx -t` 直接失败；备份放 `/etc/nginx/backups/`。
- **crrcdt 站点 nginx 已开 gzip（2026-10-19，别回退）**：入口公网带宽仅 ~1Mbps，Ubuntu nginx 默认 `gzip_types` 只有 text/html，JS/CSS/JSON 全裸传。已在 `sites-enabled/crrcdt` 443 块加 `gzip on` + `gzip_types`（JS/JSON/CSS/SVG/wasm/shell/ps1 等，level 6，min 1K）。实测 daemon bundle 5.22MB→1.42MB（28.5%）。注意 `_next/static` 资源的压缩其实来自 Next.js 上游自带 compress（浏览器带 Accept-Encoding 时一直有），nginx gzip 的增益主要在后端直出的 `/daemon/*` 与 `/api/*` 大 JSON。排障对比压缩前后必须带同样的 `Accept-Encoding` 头，否则是无效对比。
