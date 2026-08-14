---
author: qinyi
created_at: 2026-08-14T02:50:00
change: 2026-08-14-spec-sync-per-file-progress
---

# 需求：spec-sync 逐文件级进度

## 功能需求

### FR-01 task_id 透传
daemon postSpecSync/postSpecSyncIncremental HTTP 请求带 `X-Change-Write-Id: <task_id>` 头。
- 影响文件：sillyhub-daemon/src/hub-client.ts（请求头）+ spec-sync.ts（postSpecSync 接收 changeWriteId 透传）+ task-runner.ts（spec-sync 分支传 taskId）。
- impacts: task-01/02/03

### FR-02 后端循环内逐文件回写 processed
_write_spec_root per-file merge 循环 / apply_ops 逐 op 循环内，每处理一个文件用独立 session UPDATE `daemon_change_writes SET files_processed = files_processed + 1 WHERE id = change_write_id AND status = 'claimed'`（不动主事务，best-effort 失败仅 warn）。
- 影响文件：backend/app/modules/spec_workspace/service.py（apply_sync + apply_ops 加 change_write_id 参数 + 循环内回写）。
- impacts: task-04

### FR-03 路由层解析 X-Change-Write-Id
sync/sync-incremental 端点从 Request.headers 解析 X-Change-Write-Id 透传给 service。
- 影响文件：backend/app/modules/spec_workspace/router.py。
- impacts: task-04

### FR-04 files_total 上报不变
保持 P1（onWalkComplete/ops.length 报 total）。

### FR-05 前端不改
P1 Progress 条 + 轮询 files_processed 已就位，daemon 逐文件递增后自然跳动。

## 非功能需求

### NFR-01 向后兼容
X-Change-Write-Id 头缺失（旧 daemon）则不回写 processed，回退 P1 行为（0→total）。

### NFR-02 事务隔离
独立 session 写 daemon_change_writes（不同表）不冲突主 apply 事务（scan_documents/spec_file_manifest）。

### NFR-03 D-004 单一写者语义（V2）
complete_change_write 不碰计数列不变。processed 写者 = backend apply 循环（逐文件）+ daemon progress 端点（终态，若保留）。plan 补 D-004@V2 明确 writer set。

## 决策引用

- D-001@V2 逐文件级（推翻 P1 D-001 阶级级）✓
- D-002@V1 N次UPDATE性能 ✓
- D-003@V1 方案C否决（乐观锁矛盾）✓
