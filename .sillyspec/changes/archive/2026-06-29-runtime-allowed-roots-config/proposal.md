---
author: WhaleFall
created_at: 2026-06-29T10:20:20
change: 2026-06-29-runtime-allowed-roots-config
---

# Proposal: runtimes 页面配置 daemon 可访问目录（allowed_roots 沙箱）

## 问题
daemon 守护进程的文件访问沙箱（`allowed_roots`）存在本地 `config.json`，前端 list_dir RPC 浏览项目目录被拒（"path outside allowed_roots"）；CC 执行 `bypassPermissions` 读写都不受限。用户无法在 UI 管理 daemon 可访问目录。

## 方案
- backend 持久化 per-runtime `allowed_roots`（JSONB，多路径，默认 `["~/.sillyhub"]`）+ GET/PUT API + 心跳响应下发。
- daemon 心跳拉取同步本地 config（list_dir 用它，现状延续）。
- **CC 写入拦截**：daemon 启动 CC 时按 allowed_roots 注入 CC permission rules（写白名单内 allow、外 deny、读自由）。
- frontend `/runtimes` per-runtime 多路径编辑 UI。

## 影响模块
`daemon`（backend daemon 模块 + sillyhub-daemon）、`frontend_app`（/runtimes）。

## Non-Goals
- 不改 list_dir 校验语义（只改数据来源：本地 → backend 同步）。
- 不做 WS 实时推送（心跳拉取 ~15s 生效）。
- 不限制 CC 读取（读自由是明确需求）。
- 不做 fs 监控/事后回滚。

## 决策
心跳拉取同步 / per-runtime 多路径默认 ~/.sillyhub / list_dir 受限 + CC 写入受限读取自由 / CC permission 注入（方案 A）。

详见 `design.md`。
