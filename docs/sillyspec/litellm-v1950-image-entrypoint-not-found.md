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
