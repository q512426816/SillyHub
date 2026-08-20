---
schema_version: 1
doc_type: task
id: task-01
title: Daemon runtime-handler read-point selection
title_zh: daemon 读点选择（三道校验，仓库优先缓存回退）
author: qinyi
created_at: 2026-08-20T11:05:00+08:00
change_name: 2026-08-20-runtime-readpoint-repo-first
wave: 1
allowed_paths:
  - sillyhub-daemon/src/runtime-handler.ts
  - sillyhub-daemon/tests/runtime-handler.test.ts
provides:
  - pickRuntimeSpecDir(workspaceId, rootPath?) 三道校验读点选择（元字符黑名单→assertWithinAllowedRoots→.runtime 存在性）
  - RuntimeHandler 构造参数 rootsProvider / pathExists
  - normalizeRootPathParam(v: unknown): string | undefined（RPC 参数归一，供 daemon.ts 复用）
expects_from: []
goal: 四个 runtime.* 方法按 D-01@v1 规则选择读点——root_path 三道校验全过读 <root>/.sillyspec，任一不过记日志回退缓存；workspace_id 非法仍 forbidden
implementation: 构造参数扩 rootsProvider（默认 () => [] 时 root_path 分支不可用即回退）与 pathExists；新增元字符黑名单常量与 pickRuntimeSpecDir；四方法接入；导出 normalizeRootPathParam
acceptance: 六类单测全绿（仓库优先/元字符回退/越界回退/.runtime 不存在回退/无 root_path 回归/非法 workspace_id 仍 forbidden）
verify: cd sillyhub-daemon && pnpm exec vitest run tests/runtime-handler.test.ts
constraints: 元字符黑名单字符集与 design §6 逐字一致（" ' ` $ & | ; < > ( ) % ^ 及换行/回车/NUL）；回退只 catch root_path 校验路径，不吞 workspace_id forbidden；assertWithinAllowedRoots 从 file-rpc.ts 导入复用，不自实现
---

# task-01：daemon 读点选择（三道校验，仓库优先缓存回退）

依据：design.md §5.2 / §6 / D-01@v1；requirements FR-01/FR-02/FR-04；AC-02。
