---
schema_version: 1
doc_type: tasks
change_name: 2026-08-20-runtime-readpoint-repo-first
author: qinyi
created_at: 2026-08-20T02:20:00+00:00
---

# Tasks：运行时状态读点修正

> Task 编号供 plan 阶段拆 Wave 引用；依赖关系：T1→T2→T4，T3 独立，T5 收尾。

## T1 daemon：RuntimeHandler 读点选择

- `runtime-handler.ts` 构造参数增加 `rootsProvider: () => string[]` 与可选 `pathExists: (p: string) => Promise<boolean>`（测试注入）。
- 新增 `pickRuntimeSpecDir(workspaceId, rootPath?)`（命名避开 spec-sync 的 resolveSpecDir）：三道校验（元字符黑名单 → assertWithinAllowedRoots → `.runtime` 存在性）全过用 `<root>/.sillyspec`，任一不过记日志回退缓存；workspace_id 非法仍 forbidden fail-loud（catch 边界见 design §5.2）。
- 四个方法（readProgress / readUserInputs / listArtifacts / readArtifact）改用 `pickRuntimeSpecDir`，其余逻辑不动。

## T2 daemon：daemon.ts 透传参数

- `_registerRuntimeRpcHandler` 读取 `params.root_path`（非字符串归一 undefined）并透传四个 handler。
- 类字段构造点（daemon.ts:784）注入 `rootsProvider: () => this._effectiveAllowedRoots()`。

## T3 backend：RPC params 加 root_path

- `runtime/service.py` `_resolve_binding` 返回 `(daemon_id, root_path)`；四个方法 params 加 `root_path: resolve_root_path_for_daemon(binding.root_path)`。

## T4 测试（daemon + backend）

- daemon `runtime-handler.test.ts`：仓库优先 / 元字符回退 / 越界回退 / `.runtime` 不存在回退 / 无 root_path 回归 / 非法 workspace_id 仍 forbidden。
- backend `test_live_service.py`：四方法 params 含改写后 root_path；前缀改写生效；无 binding 仍 404。

## T5 frontend：截断与文案

- `runtime/page.tsx` user-inputs 超 50000 字符渲染末段 + 截断提示（含完整文件路径）；副标题改「优先本机仓库，回退同步缓存」语义；补 `page.test.tsx` 用例。

## T6 验收

- 对照 requirements AC-01~AC-04；本机起服务在 b97f8231 工作区实测 runtime 页显示真实数据。
