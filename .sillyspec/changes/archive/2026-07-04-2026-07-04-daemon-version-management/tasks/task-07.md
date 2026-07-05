---
author: qinyi
created_at: 2026-07-04 17:33:31
task_id: task-07
allowed_paths:
  - backend/app/modules/daemon/router.py
---

# task-07: backend GET /version 扩展

## 所属 Wave
Wave 2

## 文件
- 修改 `backend/app/modules/daemon/router.py`：
  - `_compute_daemon_version`（L100-116）拆分：新增 `_compute_daemon_semver`（正则提取 `DAEMON_VERSION`），保留 `_compute_daemon_version` 提取 BUILD_ID
  - 新增 `get_daemon_latest_semver()`（缓存，仿 get_daemon_latest_version L119-124）
  - **`get_daemon_latest_version()` 不变**（self-update 契约，D-009）
  - `DaemonVersionResponse`（L130-135）加 `latest_version: str` + `latest_build_id: str`（保留 latest/minRequired/downloadUrl）
  - `get_daemon_version`（L214-225）返回双值

## 验收标准
- [ ] GET /api/daemon/version 返回 latest_version（语义）+ latest_build_id（SHA）+ 旧字段
- [ ] bundle 提取失败时两字段="unknown"
- [ ] get_daemon_latest_version 仍返回 SHA（self-update 端点 router.py:527 行为不变）
- [ ] test_router GET /version 断言新字段

## 依赖
- Wave 1 完成

## 覆盖
- FR-05, D-004@V1, D-009@V1

## 风险防范
- D-009/R-07：不破坏 self-update 契约（get_daemon_latest_version 不变），新 semver 函数独立
- preflight.ts:183 用 SHA 比对，WS 推送的必须是 SHA
