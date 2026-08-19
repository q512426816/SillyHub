---
schema_version: 1
doc_type: symbol-impact
change_name: 2026-08-19-runtime-live-daemon-read
author: qinyi
created_at: 2026-08-19T07:00:00+00:00
---

# 符号影响面分析

## task-01~03: sillyspec 跨仓命令

- **变更类型**: 跨仓（`C:/Users/qinyi/IdeaProjects/sillyspec`）
- **调用点**: 本仓内无调用点（sillyspec CLI 由 daemon 侧 spawn 调用）
- **在范围内**: 是（daemon handler 将 spawn 调用）

## task-02: 实现 ProgressManager.dump 只读查询

- **变更类型**: 跨仓（`sillyspec/src/progress.js`）
- **无签名级变更**: 本仓内无调用点（dump 是新增方法，不修改现有方法签名）
- **在范围内**: 是

## task-03: progress dump JSON envelope 输出与测试

- **变更类型**: 跨仓（`sillyspec/src/progress.js` + `sillyspec/src/machine-interface.js` + `sillyspec/tests/`）
- **无签名级变更**: 本仓内无调用点（envelope 输出是新增，不修改现有签名）
- **在范围内**: 是

## task-04: 新建 RuntimeLiveService

- **变更类型**: 新增类
- **符号**: `RuntimeLiveService`（新增）
- **调用点**: 将在 task-06 被 `router.py` 调用
- **在范围内**: 是（task-04 新增，task-06 消费）

## task-05: 新增 Runtime 错误子类

- **变更类型**: 新增类
- **符号**: `RuntimeNotBound` 等 8 个类（新增）
- **调用点**: 将在 task-04/service 和 task-06/router 调用
- **在范围内**: 是

## task-06: 改造 runtime router 端点

- **变更类型**: 修改（`router.py`）
- **符号**: `get_runtime_progress` / `get_runtime_user_inputs` / `get_runtime_user_inputs_raw` / `get_runtime_artifacts` / `get_runtime_artifact_content`
- **调用点**: `router.py` 是唯一消费者，无外部调用者
- **在范围内**: 是

## task-07: 删除原快照读取路径

- **变更类型**: 删除（`service.py` 内部方法）
- **符号**: `_resolver_for` / `_resolve_runtime_dir` / `_get_base` / `_read_sqlite_progress` / `_list_artifacts_local` / `_read_text` / `_read_text_local` / `_parse_dt`（内部私有方法）
- **外部调用点**: `RuntimeService`（task-04 将替换为 `RuntimeLiveService`）
- **在范围内**: 是（router.py 不直接调用这些私有方法，只通过公开方法）

## task-08: 后端 runtime 测试改写

- **变更类型**: 修改（`test_router.py`）
- **符号**: `RuntimeService` 测试用例 → 改为 mock `RuntimeLiveService` RPC
- **调用点**: 仅测试文件内
- **在范围内**: 是

## task-09: daemon 注册 runtime RPC

- **变更类型**: 修改（`daemon.ts`）
- **符号**: `_registerRuntimeRpcHandler`（新增）
- **调用点**: daemon.ts 内部调用
- **在范围内**: 是

## task-10: 新建 daemon runtime handler

- **变更类型**: 新增（`runtime-handler.ts`）
- **符号**: `RuntimeHandler`（新增）
- **调用点**: 将在 task-09 被 daemon.ts 注册
- **在范围内**: 是

## task-11: handler 内调用 sillyspec 与文件读取

- **变更类型**: 修改（`runtime-handler.ts` 内部）
- **符号**: `readProgress` / `readUserInputs` / `listArtifacts` / `readArtifact`
- **调用点**: 仅 handler 内部
- **在范围内**: 是

## task-12: daemon runtime handler 测试

- **变更类型**: 新增（`runtime-handler.test.ts`）
- **符号**: vitest 测试
- **调用点**: 仅测试文件
- **在范围内**: 是

## task-13: 更新 RuntimePage 文案与错误提示

- **变更类型**: 修改（`page.tsx`）
- **符号**: `RuntimePage` 组件
- **调用点**: Next.js 路由渲染
- **在范围内**: 是

## task-14: 更新前端 runtime 测试

- **变更类型**: 新增/修改（`page.test.tsx`）
- **符号**: vitest 测试
- **调用点**: 仅测试文件
- **在范围内**: 是

## task-15~17: 类型同步/验收/跨仓协调

- **变更类型**: gen:types / 测试运行 / 跨仓协调
- **符号**: `api-types.ts` / `openapi.json` / `sillyhub-daemon/src/api-types.ts`
- **调用点**: 前端类型系统 / 后端 schema
- **在范围内**: 是

## task-16: 全量测试与 lint 验收

- **变更类型**: 测试运行（不修改源码，只跑测试/lint）
- **无签名级变更**: 纯测试运行，不修改任何源码签名
- **在范围内**: 是

## task-17: sillyspec 仓发版协调

- **变更类型**: 跨仓协调（`C:/Users/qinyi/IdeaProjects/sillyspec`）
- **无签名级变更**: 本仓内无调用点（跨仓发版协调不修改本仓代码）
- **在范围内**: 是
