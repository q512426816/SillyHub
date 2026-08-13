---
author: qinyi
created_at: 2026-08-13T22:23:06
change: 2026-08-13-spec-sync-visibility
---

# 任务清单（Tasks）：工作区配置页「同步到服务器」可见性增强

> 细节在 plan 阶段展开（Wave 分组 + 依赖 + 验收点）。本清单只列任务名。

## Wave 1：失败原因透传（纯前端）

- task-01：`PendingSyncItem` 整体对齐后端返回（修既有 schema 漂移：task_id/status/runtime_id/error/created_at/completed_at + 排查消费处 handleSyncManual 字段名）
- task-02：失败分支透传 `latest.error` + 测试（mock 补字段 + 失败原因可见用例）

## Wave 2：按钮提示 + 规范对齐（纯前端）

- task-03：5 按钮 antd Tooltip（含义文案 + disabled 原因文案，span 包裹解决 disabled tooltip）
- task-04：规范对齐 §5/§11（shadcn Button→antd import 重构 / size sm→middle / "…中"→loading / window.confirm→Modal.confirm）
- task-05：补 renderGuidance 缺口（导入/生成项目进行中引导框）+ 测试

## Wave 3：同步终态计数（后端+迁移+前端）

- task-06：`DaemonChangeWrite` 加 files_total/files_processed 列 + Alembic 迁移（up/down）
- task-07：`sync_manual_get_pending` 返回加 files_total/files_processed/error/completed_at
- task-08：daemon spec-sync 分支 complete 前最后一次 progress 上报（D-004 单一写者，hub-client 加 reportChangeWriteProgress + daemon.ts 接口声明）—— 依赖 task-11 端点先就位
- task-09：前端 done 分支展示「已同步 N 个文件」（files_total null 降级文案）+ PendingSyncItem 加 files_total/processed
- task-10：gen:types 同步 openapi.json + api-types.ts

## Wave 4：同步实时进度（阶段级，跨三端）

- task-11：后端新增 `PATCH /api/daemon/change-writes/{id}/progress` 端点 + ChangeWriteProgressRequest schema + status==claimed 校验（BL-3）+ 端点幂等/claim 测试
- task-12：daemon `postSpecSync` 加 onProgress 回调 + `packSpecDir` 加 onWalkComplete 钩子（BL-2）；增量(ops.length)/全量(onWalkComplete)两路径上报点
- task-13：daemon task-runner spec-sync 分支接 onProgress 到 progress 端点（含 complete 前终态上报，与 task-08 合并或协同）
- task-14：前端 syncing 分支 antd Progress 条 + 「同步中 N/M」（files_total 未知降级阶段名「打包中」，BL-2）+ 测试

## 收尾

- task-15：全量回归（前端 vitest + backend pytest spec_workspace/daemon + daemon vitest）+ gen:types diff 干净 + 模块文档更新
