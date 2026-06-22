---
author: qinyi
created_at: 2026-06-22T23:50:00
change: 2026-06-22-a1-backend-host-path
---

# Tasks: A1 backend 生成宿主路径（方案 B，D-001@v1 调整）

> 目的：backend 生成 scan/stage prompt 时直接用宿主路径（SPEC_DATA_HOST_DIR/{ws}），daemon 零客户端配置。修正原方案 A（daemon SPEC_ROOT_MAP 翻译，不可移植）。

- [ ] task-01: `backend/app/core/config.py` 加 `spec_data_host_dir` 字段（读 `SPEC_DATA_HOST_DIR` env；默认值：win32 → `C:/data/spec-workspaces`，否则与 spec_data_root 同），加 field_validator 规范化
- [ ] task-02: `backend/app/modules/agent/context_builder.py` build_scan_bundle 生成 scan 命令模板的 spec_root/runtime_root 用 `settings.spec_data_host_dir/{ws_id}`（宿主路径）；spec_workspace.spec_root（容器路径 /data/{ws}）保留供 backend 内部访问（post-check/scan_sync 在容器内跑）
- [ ] task-03: `backend/app/modules/agent/service.py` start_stage_dispatch（stage 模式 platform_args）同理用宿主 spec_root
- [ ] task-04: 测试（build_scan_bundle 平台模式 prompt 含 host 路径 C:/data/...，非 /data/）+ rebuild backend redeploy 验证 scan 无 EPERM（daemon 不需 SPEC_ROOT_MAP）

约束：
- bind mount 保证 host C:/data/{ws} == 容器 /data/{ws}（物理同一目录），backend 内部访问不受影响
- task-02 daemon SPEC_ROOT_MAP 翻译逻辑保留作兜底（向后兼容，配了仍翻译）
