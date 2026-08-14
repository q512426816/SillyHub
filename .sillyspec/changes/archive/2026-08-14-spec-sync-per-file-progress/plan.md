---
author: qinyi
created_at: 2026-08-14T03:00:00
change: 2026-08-14-spec-sync-per-file-progress
---

# 实现计划：spec-sync 逐文件级进度

## 规模分类

- has_schema_change: **false**（无新列/迁移，复用 P1 files_total/files_processed 列）
- has_state_machine_change: **false**（outbox 状态机不变）
- needs_parallel_execution: **false**（Wave 间依赖，串行）
- needs_human_review: **false**（范围聚焦，单元测试充分）
- plan_level: **full**（跨 daemon+backend，HTTP 头约定 + 独立 session 事务隔离）

## Wave 依赖总览

```
W1(daemon task_id 透传) → W2(backend 循环内回写) → W3(测试+收尾)
```

W1 先让 daemon 能传 task_id；W2 后端接收 + 循环内回写；W3 测试验证。串行（W2 依赖 W1 的头约定）。

## 关键契约（provides/expects_from 对账）

| provider task | provides 契约 | consumer task |
|---|---|---|
| task-01（hub-client 头） | `X-Change-Write-Id` 请求头 | task-02, task-04 |
| task-04（backend 回写） | apply 循环内 processed 递增 | task-05（测试验证） |

## Wave 1：daemon task_id 透传（FR-01）

串行（hub-client → spec-sync → task-runner）。

- [x] task-01: hub-client.ts postSpecSync/postSpecSyncIncremental 加 X-Change-Write-Id 请求头（FR-01）。provides: 请求头契约。
  - allowed_paths: `sillyhub-daemon/src/hub-client.ts`
- [x] task-02: spec-sync.ts postSpecSync 接收 changeWriteId 参数透传给 client（FR-01）。depends_on: task-01。
  - allowed_paths: `sillyhub-daemon/src/spec-sync.ts`
- [x] task-03: task-runner.ts spec-sync 分支调 postSpecSync 时传 taskId（FR-01）+ 明确 P1 onProgress 去留（D-004@V2：保留 files_total 上报，processed 改由 backend 写，daemon 终态上报 processed 移除避免双写）。depends_on: task-02。
  - allowed_paths: `sillyhub-daemon/src/task-runner.ts`

## Wave 2：backend 循环内回写 processed（FR-02/03）

- [x] task-04: router.py sync/sync-incremental 解析 X-Change-Write-Id 头（FR-03）+ service.py apply_sync(_write_spec_root)/apply_ops 接收 change_write_id 参数，per-file/op 循环内用独立 session UPDATE files_processed+=1 WHERE status='claimed'（FR-02，best-effort 失败仅 warn，头缺失向后兼容不回写）。depends_on: task-01（头契约）。
  - allowed_paths: `backend/app/modules/spec_workspace/router.py`, `backend/app/modules/spec_workspace/service.py`

## Wave 3：测试 + 收尾

- [x] task-05: 后端测试（apply 循环内 processed 逐文件递增 + 独立 session 不破坏主事务回滚 + 头缺失向后兼容 + status='claimed' 守卫）+ daemon 测试（task_id 透传）+ 全量回归 + 模块文档。depends_on: task-04, task-03。
  - allowed_paths: `backend/app/modules/spec_workspace/tests/`, `sillyhub-daemon/tests/`, `.sillyspec/docs/backend/modules/spec_workspace.md`, `.sillyspec/docs/sillyhub-daemon/modules/spec-sync.md`

## 验收点

- W1：daemon sync HTTP 请求带 X-Change-Write-Id 头；task-runner 传 taskId；P1 onProgress 的 processed 终态上报移除（避免双写，files_total 保留）。
- W2：backend apply 循环内每文件 processed+=1；独立 session 不影响主事务 commit/rollback；头缺失不回写（兼容）；status='claimed' 守卫。
- W3：processed 逐文件递增测试（35 文件→processed 0→1→...→35）；主事务失败回滚时 processed 不阻塞（best-effort）；全量回归绿。

## 风险（继承 design.md）

- 独立 session N 次 UPDATE 连接池压力（pool 50，顺序短 session 无压力，超大树留 K 文件合并优化）。
- 主事务失败 processed 已推进不一致（终态 complete 覆盖，processed 中间值无实际危害）。
