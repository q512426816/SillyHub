---
author: qinyi
created_at: 2026-08-14T02:50:00
change: 2026-08-14-spec-sync-per-file-progress
---

# 任务清单：spec-sync 逐文件级进度

> 细节在 plan 阶段展开。本清单只列任务名。

## Wave 1：daemon task_id 透传

- task-01：hub-client.ts postSpecSync/postSpecSyncIncremental 加 X-Change-Write-Id 请求头
- task-02：spec-sync.ts postSpecSync 接收 changeWriteId 参数透传给 client
- task-03：task-runner.ts spec-sync 分支调 postSpecSync 时传 taskId（+ 明确 P1 onProgress 去留，见 D-004@V2）

## Wave 2：后端循环内回写 processed

- task-04：router.py sync/sync-incremental 解析 X-Change-Write-Id 头 + service.py apply_sync/apply_ops 接收 change_write_id 参数，循环内独立 session 回写 files_processed+=1（status='claimed' 守卫，best-effort）

## Wave 3：测试 + 收尾

- task-05：后端测试（apply 循环内 processed 逐文件递增 + 独立 session 不破坏主事务 + 头缺失向后兼容）+ daemon 测试（task_id 透传）+ 全量回归
