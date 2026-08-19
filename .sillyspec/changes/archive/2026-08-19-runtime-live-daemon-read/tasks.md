---
schema_version: 1
doc_type: tasks
change_name: 2026-08-19-runtime-live-daemon-read
author: qinyi
created_at: 2026-08-19T06:25:00+00:00
---

# 任务清单（Tasks）

## Wave 1：跨仓 sillyspec 只读进度命令

- task-01：sillyspec 新增 `progress dump --spec-dir <path> --json` 命令
- task-02：`ProgressManager.dump()` 只读查询实现与测试
- task-03：machine-interface envelope 输出与 schema 测试

## Wave 2：后端 RuntimeLiveService 与错误映射

- task-04：新建 `RuntimeLiveService` 及 `runtime.*` RPC 调用封装
- task-05：新增 `Runtime*` 错误子类（与 explorer 映射逻辑一致）
- task-06：改造 `runtime/router.py` 端点调用 `RuntimeLiveService`
- task-07：删除/迁移原 `RuntimeService` 容器直读快照逻辑
- task-08：后端单元/集成测试改写（mock daemon RPC）

## Wave 3：sillyhub-daemon runtime RPC handler

- task-09：daemon.ts 注册 `runtime.*` 四个 RPC 方法
- task-10：新建 `runtime-handler.ts`（进度/用户输入/产物读取）
- task-11：handler 内部 spawn sillyspec `progress dump` 与文件读取
- task-12：daemon 单元测试

## Wave 4：前端文案与错误提示

- task-13：改造 `/workspaces/[id]/runtime/page.tsx` 标题/副标题/错误提示
- task-14：前端 vitest 测试更新

## Wave 5：类型同步与验收

- task-15：`pnpm gen:types` 同步 backend OpenAPI 变更
- task-16：全量测试验收（backend pytest + daemon vitest + frontend vitest）
- task-17：sillyspec 仓测试与版本协调
