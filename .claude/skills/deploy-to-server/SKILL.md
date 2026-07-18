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
- 4 个容器全 healthy（backend / frontend / postgres / redis）
- health 返回 `{"status":"ok","db":"ok","redis":"ok",...}`

backend 镜像变更会自动跑 `alembic upgrade head`，看 logs 确认无报错：
```bash
ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252 'cd /opt/sillyhub/deploy/deploy && docker compose logs backend --tail=40'
```
- 看到 `Application startup complete` + `Uvicorn running on http://0.0.0.0:8000` = 成功
- 看到 alembic 报错 / 容器反复重启 = migration 问题，见下方「回滚」

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
python -c "import secrets; print('SECRET_KEY='+secrets.token_urlsafe(32)); print('SILLYSPEC_MASTER_KEY='+secrets.token_urlsafe(32))"
# SSH 进去填（或本地编辑后 scp 覆盖）：
ssh -i ~/.ssh/aliyun_deploy root@47.113.145.252 'vi /opt/sillyhub/deploy/deploy/.env'
```

必填生产值（**不要把真实 token/密码写进 skill 或提交**）：
```env
BACKEND_PORT=8001
FRONTEND_PORT=3001
SECRET_KEY=<随机48字符>
SILLYSPEC_MASTER_KEY=<随机48字符>
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
> 默认账号按 `.env` 的 `PLATFORM_BOOTSTRAP_ADMIN_*`。登录用 username 非 email（见 memory `login-by-username-not-email`，默认 admin/admin123 或 `.env` 密码）。

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
