---
author: WhaleFall
created_at: 2026-06-29T10:20:20
change: 2026-06-29-runtime-allowed-roots-config
---

# Requirements: runtimes allowed_roots 配置

## 功能需求
- **FR-01**：backend `daemon_runtimes` 加 `allowed_roots`（JSONB 数组，默认 `["~/.sillyhub"]`）+ migration（存量回填）。
- **FR-02**：`GET /api/admin/daemon/runtimes` 返回 allowed_roots；`PUT /api/admin/daemon/runtimes/{id}/allowed-roots`（admin 权限，校验路径）。
- **FR-03**：`POST /daemon/heartbeat` 响应带 allowed_roots，daemon 拉取同步本地 config（合并 homedir 兜底）。
- **FR-04**：list_dir 继续用 config.allowed_roots（白名单内放行、外拒绝，现状不变）。
- **FR-05**：CC 写入受限——daemon 启动 CC 按 allowed_roots 注入 permission rules（allow Write 白名单、deny Write(**)、读自由）；batch（stream-json adapter）+ interactive（claude-sdk-driver）。
- **FR-06**：frontend `/runtimes` per-runtime allowed_roots 展示 + 多路径编辑（admin），调 PUT API。
- **FR-07**：新 runtime 注册默认 `["~/.sillyhub"]`。

## 用户场景（Given/When/Then）
- **配置**：Given admin 在 /runtimes，When 编辑某 runtime allowed_roots 加 `F:/WorkNew/SillyHub` 保存，Then backend 持久化 + 下次心跳 daemon 同步。
- **list_dir**：Given daemon 已同步 allowed_roots 含项目路径，When 前端 list_dir 浏览该项目，Then 放行（不再 "outside allowed_roots"）。
- **CC 写**：Given CC 在项目根执行，When CC Write 项目内文件，Then 成功；When CC Write 白名单外，Then CC permission 拒绝（日志可见）。
- **CC 读**：Given CC 执行，When CC Read 任意路径，Then 成功（读自由）。

## 验收（见 design §9）
1. /runtimes 显示+编辑 allowed_roots 持久化。2. 心跳 ~15s 同步。3. list_dir 白名单内放行。4. CC 写白名单内成功/外拒绝。5. CC 读自由。6. 新 runtime 默认 ~/.sillyhub。7. 兼容（未配置原样）。

## 剩余风险（execute 确认）
- CC permission 路径语法（`Write(//path/**)`）+ 注入方式。
- acceptEdits + allow rules 白名单内写是否自动。
- 心跳响应向后兼容（旧 daemon 不读 allowed_roots）。
