# 低配服务器构建前端 next build V8 堆 OOM（需 NODE_OPTIONS 注入）

- 发现日期：2026-10-02（阿里云 2c/1.6G 服务器更新部署实测）
- 影响面：`deploy/` 服务器直接构建路径（本地打包传镜像的主路径不受影响）

## 现象

服务器 `docker compose up -d --build`（源码 git archive 同步后）frontend 构建
在 `next build` 编译约 64 分钟处崩：

```
FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory
```

后续 `COPY --from=builder /app/.next/standalone` 报
`failed to calculate checksum ... "/app/.next/standalone": not found`——
**表象是 BuildKit checksum 错（易误诊为缓存损坏），根因是 build 产物缺失（OOM）**。
dmesg 无 OOM-kill（非内核击杀，是 V8 自身堆上限），服务器已有 4G swap 仍在。

## 处置（2026-10-02 部署窗口）

服务器副本 `frontend/Dockerfile` 在 `RUN pnpm build` 前注入：

```dockerfile
ENV NODE_OPTIONS=--max-old-space-size=3072
```

重跑后编译 2h51m 通过（swap 承接溢出，峰值 swap ~2.3G）。

## 已知缺口

- 该注入只在服务器副本（`/opt/sillyhub/deploy/frontend/Dockerfile`），**下次
  源码同步（git archive 解包覆盖）会丢失**——根治需仓库侧给 Dockerfile builder
  阶段加同款 ENV（或 ARG 可覆盖）。属一行级小修复，走 thin 变更收口。
- 服务器构建前端全程 ~3h（编译 2h51m），仅作本地 Docker 不可用时的兜底；
  恢复本地构建路径（build-and-save.sh 传镜像）仍是首选。

## 关联坑（本次同窗口实证）

- WSL `WslService` 卡 STOP_PENDING 会让本机 Docker 引擎起不来（`wsl -l -v` 挂死、
  `Wsl/0x80080005`），需提权重启服务或重启机器——本地构建路径被此堵死后才走的
  服务器构建。
- 服务器 compose 必填变量随仓库演进增多（MINIO_ROOT_PASSWORD / S3_ACCESS_KEY /
  S3_SECRET_KEY / LITELLM_*）：老 `.env` 会被 `docker compose config` 逐个拦下；
  本次从运行容器回填（minio/S3 凭据保持现值）+ 新生成 litellm 密钥。
