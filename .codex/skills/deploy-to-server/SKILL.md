---
name: deploy-to-server
description: 本地打包镜像→远程服务器（阿里云）部署，替代服务器现场构建。适合用户说"部署到服务器"、"远程部署"、"更新生产环境"、"首次部署到阿里云"、"打包传镜像"、"不在服务器构建"。区分首次部署（服务器从零）和更新部署（已有环境换镜像）。
---

# 远程服务器部署（本地打包 → 阿里云）

## 目标

把当前仓库部署到阿里云服务器，**本地构建镜像、传到服务器、服务器不构建直接起**——避开服务器 2 核前端 `next build` 15-20 分钟的瓶颈。用 `docker save`/`load`，不需要镜像仓库（registry）。

先判断走哪条路径：

```bash
ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252 'docker compose ls 2>/dev/null; ls /opt/sillyhub/deploy/deploy/.env 2>/dev/null'
```

- 有 `multi-agent-platform` running + `.env` 存在 → **更新部署**
- 没有 → **首次部署**

## 服务器固定信息

- SSH：`ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252`（密钥在本机 `~/.ssh/aliyun_deploy`，直连或走 Clash SOCKS5 7897 代理）
- 活跃 compose 目录：`/opt/sillyhub/deploy/deploy/`（**双层 deploy，不是 `/opt/sillyhub/deploy/`**，两份都存在，活跃的是深层那份）
- 端口：前端 3001、后端 8001（宿主映射）
- 规格：2 核 / 40G 盘
- 架构：linux/amd64（和本地 Docker Desktop 构建出的 linux/amd64 一致，**无需交叉编译**）

## 更新部署（日常用，最常用）

### 1. 本地打包（20 核，几分钟）

daemon 的 `src/` 改过才要重打 bundle（只改 install 脚本不影响 bundle JS，可跳过）：
```bash
cd sillyhub-daemon && pnpm bundle && cd ..   # 产出 build/bundle/{sillyhub-daemon.js,mcp-server.js}
```

打包（生产 API 地址覆盖前端 build-arg；本地 `.env` 的 `127.0.0.1` 是开发值，必须覆盖）：
```bash
PROD_API_URL=http://192.168.0.143:8001 bash deploy/scripts/build-and-save.sh
# 产出 deploy/images.tar.gz（backend + frontend 两镜像 gzip，约 300M）
```

> `PROD_API_URL` 是生产环境前端浏览器访问后端的地址（取自服务器 `.env` 的 `NEXT_PUBLIC_API_BASE_URL`）。改了必须重新打包前端（`NEXT_PUBLIC_` 是 build 时固化到客户端的）。

### 2. 传到服务器

```bash
scp -i ~/.ssh/aliyun_deploy deploy/images.tar.gz deploy/scripts/load-and-up.sh \
  root@47.113.145.252:/opt/sillyhub/deploy/deploy/
```

传完确认脚本是 LF（CRLF 会让服务器 bash 报 `bad interpreter`）：
```bash
ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252 "grep -c \$'\r' /opt/sillyhub/deploy/deploy/load-and-up.sh"
# 应返回 0
```

### 3. 服务器部署（不构建）

**稳妥做法（先备份旧镜像再 load，便于回滚）**：
```bash
ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252 'cd /opt/sillyhub/deploy/deploy && \
  STAMP=$(date +%Y%m%d-%H%M) && \
  docker tag multi-agent-platform-backend:latest  multi-agent-platform-backend:backup-$STAMP && \
  docker tag multi-agent-platform-frontend:latest multi-agent-platform-frontend:backup-$STAMP && \
  echo "✅ 备份 backup-$STAMP（回滚用）" && \
  gunzip -c images.tar.gz | docker load && \
  docker compose --env-file .env up -d'
```

**日常重复部署（load + up + 清 dangling + 删 tar 一条龙）**：
```bash
ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252 'cd /opt/sillyhub/deploy/deploy && bash load-and-up.sh'
```

### 4. 验证

```bash
ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252 'cd /opt/sillyhub/deploy/deploy && \
  docker compose ps && \
  curl -s http://127.0.0.1:8001/api/health'
```
- 5 个容器全 healthy（backend / frontend / postgres / redis / minio）
- health 返回 `{"status":"ok","db":"ok","redis":"ok",...}`

backend 镜像变更会自动跑 `alembic upgrade head`，看 logs 确认无报错：
```bash
ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252 'cd /opt/sillyhub/deploy/deploy && docker compose logs backend --tail=40'
```
- 看到 `Application startup complete` + `Uvicorn running on http://0.0.0.0:8000` = 成功
- 看到 alembic 报错 / 容器反复重启 = migration 问题，见下方「回滚」

**若本次动了 daemon bundle 或 install 脚本，再验 daemon 分发端点**（公网经 nginx 与后端容器
必须一致，不一致 = nginx 在用静态旧副本，见下方「nginx 与 daemon 分发」）：
```bash
ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252 '
  curl -s -H "Cache-Control: no-cache" https://<域名>/daemon/latest.json; echo
  curl -s http://127.0.0.1:8001/daemon/latest.json; echo'
```

### 回滚

```bash
ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252 'cd /opt/sillyhub/deploy/deploy && \
  docker tag multi-agent-platform-backend:backup-<时间>  multi-agent-platform-backend:latest && \
  docker tag multi-agent-platform-frontend:backup-<时间> multi-agent-platform-frontend:latest && \
  docker compose --env-file .env up -d'
```
（`<时间>` 用 `docker images | grep backup` 查。）

## 首次部署（服务器从零）

### 1. 服务器装 Docker（阿里云内网，配国内源加速）
```bash
ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252 '
  curl -fsSL https://get.docker.com | bash -s docker --mirror Aliyun &&
  systemctl enable --now docker &&
  docker compose version'
```

### 2. 建目录、放部署文件
```bash
ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252 'mkdir -p /opt/sillyhub/deploy/deploy'
scp -r -i ~/.ssh/aliyun_deploy deploy/docker-compose.yml deploy/.env.example deploy/scripts \
  root@47.113.145.252:/opt/sillyhub/deploy/deploy/
```

### 3. 配 .env（生产值）
```bash
ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252 'cd /opt/sillyhub/deploy/deploy && cp .env.example .env'
# 本地生成密钥：
python -c "import secrets; print('SECRET_KEY='+secrets.token_urlsafe(32)); print('SILLYSPEC_MASTER_KEY=v1:'+secrets.token_hex(32))"
# SSH 进去填（或本地编辑后 scp 覆盖）：
ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252 'vi /opt/sillyhub/deploy/deploy/.env'
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

备选：服务器直接构建（2 核前端要 15-20 分钟，需服务器上有完整源码 + `sillyhub-daemon/build/bundle/`）：
```bash
ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252 'cd /opt/sillyhub/deploy/deploy && \
  export COMMIT_SHA=$(cd /opt/sillyhub && git rev-parse --short HEAD 2>/dev/null || echo local) && \
  docker compose --env-file .env up --build -d'
```

### 5. 验证 + 初始化

同「更新部署」第 4 步。首次额外建 workspace（`root_path` 落在 compose 挂载目录）：
```bash
TOKEN=$(ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252 'curl -fsS -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@sillyhub.local\",\"password\":\"<密码>\"}" \
  http://127.0.0.1:8001/api/auth/login' | jq -r .access_token)
```
> 账号按 `deploy/.env` 的 `PLATFORM_BOOTSTRAP_ADMIN_EMAIL` / `PLATFORM_BOOTSTRAP_ADMIN_PASSWORD`（部署前务必改为强口令）。登录用 username 非 email（见 memory `login-by-username-not-email`）。

## nginx 与 daemon 分发（/daemon/* 必须走后端，禁止静态 alias）

对外域名（如 `crrcdt.ppdmq.top`）前面有一层宿主机 nginx 反代。**`/daemon/` 下所有文件
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
    proxy_pass http://127.0.0.1:8001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
}
```

**部署/排障时怎么发现脱节**：对比「公网经 nginx」与「后端容器直出」是否一致——

```bash
ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252 '
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

- **活跃 compose 目录是 `/opt/sillyhub/deploy/deploy/`**（双层 deploy），scp 和 ssh 都进深层目录，不是 `/opt/sillyhub/deploy/`。
- **PROD_API_URL 必须覆盖**：本地 `deploy/.env` 的 `NEXT_PUBLIC_API_BASE_URL=127.0.0.1:8001` 是开发值，直接打包给生产，浏览器会连用户自己机器。用 `PROD_API_URL=生产地址` 覆盖（环境变量 > `.env`）。
- **.sh 必须 LF**：`.gitattributes` 已强制 `*.sh eol=lf`，scp 前确认 `grep \r = 0`，否则服务器 `bash\r: bad interpreter`。
- **backend Dockerfile apt 源用清华 tuna**：`mirrors.aliyun.com` 的 debian trixie Packages 索引缺失会让 backend build 卡死（2026-07-17 已改 tuna）。
- **磁盘**：40G 盘。`load-and-up.sh` 自动 `image prune -f` + 删 tar。但 `backup-<时间>` tag 会累积，定期手动清：`docker images | grep backup` → `docker rmi <旧backup>`。
- **commit_sha=unknown**：health 端点这个字段恒 `unknown` 是既有问题（compose 运行时 `COMMIT_SHA` 覆盖镜像 build 值），不影响功能，见 memory `compose-commit-sha-runtime-override`。
- **backend 变更触发 alembic**：load + up 后 backend 启动跑 `alembic upgrade head`。migration 链断裂会 crash-loop，看 logs 诊断；项目未上线，可 `docker compose down -v` 重置 DB（先确认数据可丢）。
- **daemon bundle**：backend 镜像依赖 `sillyhub-daemon/build/bundle/`。daemon 的 `src/` 改过必须 `pnpm bundle` 再打包；只改 `scripts/install.*` 不影响 bundle JS（随 rebuild 自动 COPY 最新源）。
- **不要碰 ppdmq-\***：服务器另有 `ppdmq-app/redis/mysql` 是别的项目，部署只动 `multi-agent-platform-*` 容器。
- **容器端口用 127.0.0.1**：本机 curl 验证服务器映射端口用 `127.0.0.1`（在服务器上 ssh 内执行），不要用 `localhost`（IPv6 解析问题）。
- **`/daemon/` 别让 nginx 静态 alias**：宿主机 `/var/www/sillyhub/daemon/` 这类静态副本不随镜像更新，会吐旧 bundle/旧 install.ps1（无 BOM、`{{SERVER_URL}}` 未替换）。整段 `location /daemon/` 必须 `proxy_pass` 到后端。排障/部署后对比公网与后端 latest.json 版本是否一致。详见上方「nginx 与 daemon 分发」。
