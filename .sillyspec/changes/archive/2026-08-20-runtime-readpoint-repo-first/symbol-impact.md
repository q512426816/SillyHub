---
author: qinyi
created_at: 2026-08-20T11:20:00+08:00
---

# 符号影响面报告（Symbol Impact）— 运行时状态读点修正

逐 task 扫描本变更触及的符号（新增/签名变更/消费关系），无签名级变更也显式注明。

## task-01 daemon 读点选择

| 符号 | 变更类型 | 影响面 |
|---|---|---|
| `RuntimeHandler` 构造 opts | 签名扩展（新增可选 `rootsProvider: () => string[]`、`pathExists?: (p: string) => Promise<boolean>`） | 向后兼容（可选字段）；调用方仅 daemon.ts:784（task-04）与 runtime-handler.test.ts（task-01 自带） |
| `pickRuntimeSpecDir(workspaceId, rootPath?)` | 新增私有方法 | 类内四方法接入 |
| `normalizeRootPathParam(v: unknown): string \| undefined` | 新增导出函数 | daemon.ts 接线消费（task-04）+ 测试 |
| `runProgress / readUserInputs / listArtifacts / readArtifact` | 签名扩展（新增可选第二参 `rootPath?: string`） | 向后兼容；调用方仅 daemon.ts 注册器（task-04） |
| `specCacheRootFor` | 不变（作为回退分支继续使用） | — |
| 元字符黑名单常量 | 新增 | pickRuntimeSpecDir 内部 |

## task-02 backend RPC params

| 符号 | 变更类型 | 影响面 |
|---|---|---|
| `RuntimeLiveService._resolve_binding` | 返回值变更（`uuid` → `tuple[uuid, str]`） | 私有方法，调用方仅同类四方法（service.py:202/216/229/243），全量 grep 已确认无外部引用 |
| `RuntimeLiveService.get_progress / get_user_inputs / get_artifacts / get_artifact_content` | 公有签名不变；实现内 RPC params dict 增 `root_path` 键 | 消费方 router.py（不动）；RPC 对端 daemon（老 daemon 忽略新键） |
| `resolve_root_path_for_daemon`（workspace/service.py:75，既有） | 不变，新增消费 | task-02 import |

## task-03 frontend

| 符号 | 变更类型 | 影响面 |
|---|---|---|
| `RuntimePage` 组件 | 内部渲染逻辑（截断+文案）；导出签名不变 | page.test.tsx 连带（task-03 自带） |
| `getRuntimeUserInputsRaw` 等 lib 客户端 | 不变 | — |

## task-04 daemon.ts 接线

| 符号 | 变更类型 | 影响面 |
|---|---|---|
| `Daemon._registerRuntimeRpcHandler` | 内部实现（四 handler 透传 root_path） | 私有方法，无外部消费 |
| `Daemon` 类字段 `this._runtimeHandler` 构造点 | 构造参数增 rootsProvider | 与 task-01 构造签名对齐 |
| 消费 `normalizeRootPathParam` | 新增 import | task-01 provides |

## task-05 local.yaml 映射

无签名级变更（YAML 配置条目新增，不触及代码符号）。

## task-06 端到端验收

无签名级变更（验收动作，不触及代码符号）。

## 跨任务签名一致性

- `normalizeRootPathParam`：task-01 定义 / task-04 消费，命名与语义在两 TaskCard 声明一致。
- `rootsProvider` 构造参数：task-01 定义（对齐 HostFsHandler 范式）/ task-04 注入 `() => this._effectiveAllowedRoots()`，一致。
- RPC params `root_path` 键名：task-02 产出（snake_case，与既有 workspace_id 一致）/ task-01+04 消费（`params.root_path`），一致。
