---
author: WhaleFall
created_at: 2026-07-01 11:27:42
---

# design：spec-workspace import 异步化（SSE）+ 变更中心补 change reparse

## 1. 背景与问题

workspace `8f8a1d7f`（daemon-client）导入 spec 后：

- **变更中心空**：`Change` 表无数据。根因双重：
  1. ql-20260701-003 误把 `changes` 从 `get_spec_bundle` 打包中排除（`packSpecDir excludeNames:['changes']`），最新导入 spec_root 无 `changes/`。
  2. `apply_sync`（spec_workspace/service.py:489-505）落盘后只调 `ScanDocService.reparse`（docs），**漏了 `ChangeService.reparse`**（changes）——即使 changes 导入，`Change` 表也不填，变更中心读不到。
- **import 报 500**：含 changes（1100 文件/12M）时 daemon `packSpecDir` 打包实测 16.8s（Windows walkDir 万级文件 stat 慢）+ WS 传 16M base64 + reparse 2.7s ≈ 22s > frontend Next.js 14.2.5 rewrite proxy 超时 → `socket hang up` ECONNRESET 500（backend 业务实际成功，仅前端误报）。

## 2. 目标

- 变更中心能显示导入的 changes（含 archive 历史）。
- import 不再因打包慢/proxy 超时报 500。
- daemon-client 物理限制不变：`root_path` 在宿主机，必须 daemon 读（backend 容器读不到）。

## 3. 方案概览（用户确认方案 A：SSE 流式）

所有改动围绕同一 import 链路，强耦合，单变更完成。

### 3.1 daemon（sillyhub-daemon）
- 撤 ql-003 的 `get_spec_bundle` `excludeNames:['changes']`，恢复 changes 导入。
- `excludeRuntime:true` 保留（.runtime 含 worktrees 2.1G，必排，ql-002 已修 + walkDir 剪枝）。
- `get_spec_bundle` **不改流式**：一次性 tar，`packing` 阶段阻塞 ~16.8s（SSE 推 `packing` 占位）。

### 3.2 backend spec_workspace
- `import_from_repo` 改 SSE：router 返回 `StreamingResponse(media_type="text/event-stream")`，service 提供 async generator 推阶段事件。
- SSE 事件序列：
  ```
  event: packing      data: {"phase":"packing"}
  event: packed       data: {"phase":"packed","tar_bytes":N}
  event: applying     data: {"phase":"applying"}
  event: reparsing_docs   data: {"phase":"reparsing_docs","parsed":N}
  event: reparsing_changes data: {"phase":"reparsing_changes","parsed":N}
  event: done         data: {"phase":"done","spec_workspace":{...}}
  event: error        data: {"code":"...","message":"..."}
  ```
- `apply_sync` 顺序调 `ScanDocService.reparse`(docs) + `ChangeService.reparse`(changes)，**各自 try/except**：失败设 `sync_status="dirty"`（与现有 ScanDoc 容错一致），SSE 推该阶段 error 但**流不中断**（继续下一阶段或结束）。两阶段 parsed 数都推给前端。
- daemon-client 错误（`DaemonRuntimeOffline`/`DaemonRpcTimeout`/`DaemonRpcConflict`/`DaemonRpcRemoteError`）→ SSE `error` 事件透传 ql-001 的 code，然后关闭流。
- server-local 分支同样 SSE（直接读 `.sillyspec` → 落盘 → reparse docs+changes）。
- 参考现有 SSE 范式：`agent/router.py:447`、`daemon/router.py:1353`（都用 `StreamingResponse` text/event-stream）。

### 3.3 backend sync 端点（POST /spec-workspace/sync）
- daemon 上传 tar 走 sync 端点（非 SSE，仍 JSON）。`apply_sync` 加 `ChangeService.reparse` 后，sync 自动生效（一致性）。
- 响应 DTO 扩展：`{ok, reparsed_docs, reparsed_changes}`。

### 3.4 frontend
- `lib/spec-workspaces.ts` `importSpecWorkspace` 改流式：`fetch(POST)` + 读 `response.body`（ReadableStream）逐 chunk 解析 SSE 事件。
- workspace 详情页 import 按钮：按 SSE 事件更新阶段进度文本（打包中→落盘中→解析文档(N)→解析变更(N)→完成）。
- `done` 事件后刷新 `spec_ws` + 触发变更中心数据重新拉取（让 changes 立即显示）。
- `error` 事件 → `setPageError(message)`。

## 4. 关键决策

- **D-001 import 改 SSE**：破坏现有 `POST /import` 返回 `SpecWorkspaceRead`（JSON）的契约，前端 `importSpecWorkspace` 必改（JSON fetch → 流式 SSE 读）。trade-off：根治 proxy 超时 + 实时进度，代价是前端改造 + SSE 错误/生命周期管理。
- **D-002 撤 ql-003 excludeNames changes**：恢复全 changes 导入（含 archive）。ql-003 排除 changes 是为治打包慢的错判——用户需要 changes（变更中心依赖）。打包慢改由 D-001 异步化解决，而非排除数据。
- **D-003 apply_sync 顺序 reparse docs + changes，各自容错**：两阶段独立 try/except，单阶段失败设 dirty 不阻断另一阶段（docs 和 changes 是独立数据，部分成功优于全失败）。与现有 ScanDoc reparse 失败 dirty 模式一致。
- **D-004 daemon get_spec_bundle 不流式**：WS RPC 是 request-response 语义，改流式（边打包边推）复杂且收益有限（16.8s 占位可接受）。SSE `packing` 阶段阻塞等 daemon 一次性返回。

## 5. 数据流（daemon-client，正常路径）

```
前端 POST /import (Accept: text/event-stream)
  → backend import_from_repo SSE generator
  → [packing] send_rpc get_spec_bundle → daemon packSpecDir(excludeRuntime only) ~16.8s
  → daemon 返回 tar_base64(12M)
  → [packed] tar_bytes=12M
  → [applying] apply_sync 写 spec_root（整树覆盖，含 changes/）
  → [reparsing_docs] ScanDocService.reparse → parsed=205
  → [reparsing_changes] ChangeService.reparse → parsed=N（changes 入 Change 表）
  → [done] spec_workspace{sync_status:clean}
前端 done 后刷新变更中心 → Change 表有数据 → 显示
```

## 6. 错误处理矩阵

| 场景 | SSE 行为 | sync_status |
|---|---|---|
| daemon 离线 | `error{HTTP_504_DAEMON_RUNTIME_OFFLINE}` → 关闭 | 不变 |
| daemon RPC 超时(>60s) | `error{HTTP_504_DAEMON_RPC_TIMEOUT}` → 关闭 | 不变 |
| daemon 打包失败(remote) | `error{HTTP_502_DAEMON_RPC_REMOTE}` → 关闭 | 不变 |
| 落盘失败 | `error{...}` → 关闭 | dirty |
| reparse docs 失败 | 推 docs 阶段 error，继续 changes 阶段 | dirty |
| reparse changes 失败 | 推 changes 阶段 error，继续 done | dirty |

## 7. 并发与幂等
- SSE 单连接天然串行：同一 workspace 同时只有一个 import SSE 流（前端按钮 import 中禁用）。
- 后端可选：workspace 级 import 互斥锁（防多端同时 import）。本期用前端按钮禁用 + DB `sync_status` 兜底，不引入显式锁（YAGNI）。

## 8. 兼容性
- 本项目未上线，允许重置数据（CLAUDE.md 规则10）。`POST /import` 响应类型变（JSON→SSE）不需向后兼容。
- `POST /sync` 响应 DTO 扩展字段（`reparsed_docs`/`reparsed_changes`），向后兼容（旧客户端忽略新字段）。

## 9. 验收
- AC-01 daemon-client workspace 导入后，变更中心显示 changes（含 archive）。
- AC-02 import 全程 SSE 推阶段事件，无 proxy 500。
- AC-03 daemon 离线时 SSE 推 504 error 事件并正常关闭（不挂死）。
- AC-04 reparse docs/changes 各自失败时 sync_status=dirty，流继续。
- AC-05 sync 端点上传 tar 后 changes 也入 Change 表。
- AC-06 spec_workspace 全模块 + change 模块测试通过；ruff/format/mypy 过；daemon vitest 过。

## 10. 不做（Non-Goals）
- 不改 daemon `get_spec_bundle` 流式（D-004）。
- 不改 ScanDocService/ChangeService 内部解析逻辑（只调它们）。
- 不引入 import 任务持久化（SSE 内存即可，YAGNI）。
- 不优化 daemon walkDir 并行 stat（16.8s 在 60s timeout 内，YAGNI；留作后续）。

## 11. 文件变更清单

### backend
- `app/modules/spec_workspace/service.py`：`import_from_repo` 改返回 async generator（SSE 事件）；`apply_sync` 拆分（apply 写盘 / reparse_docs / reparse_changes 三段，各自 try/except 设 dirty，返回各段 parsed）；新增 SSE 事件构造 helper。
- `app/modules/spec_workspace/router.py`：`import_spec_workspace` 返回 `StreamingResponse(media_type="text/event-stream")`；`SpecSyncResponse` DTO 加 `reparsed_changes`。
- `app/modules/spec_workspace/schema.py`：`SpecSyncResponse` 加 `reparsed_changes: int`；SSE 事件 schema（内部用）。
- `app/modules/spec_workspace/tests/`：新增 SSE import 测试（阶段事件、daemon 离线 error、reparse 失败 dirty、sync 端点 change reparse）。

### sillyhub-daemon
- `src/daemon.ts`：`get_spec_bundle` 撤 `excludeNames:['changes']`，仅保留 `excludeRuntime:true`。
- `src/spec-sync.ts`：`packSpecDir` 的 `excludeNames` 选项保留（通用能力），但 `get_spec_bundle` 不再传 changes。
- `tests/spec-sync.test.ts`：更新 get_spec_bundle 调用期望（含 changes）。

### frontend
- `src/lib/spec-workspaces.ts`：`importSpecWorkspace` 改流式（原生 fetch + ReadableStream + TextDecoder 解析 SSE），接受 onProgress 回调。
- `src/lib/api.ts`：不动（SSE 绕过 apiFetch）。
- `src/app/(dashboard)/workspaces/[id]/page.tsx`：`handleImport` 改用流式 importSpecWorkspace，按事件更新阶段进度 UI；done 后刷新 spec_ws + 变更中心数据。

## 12. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| Next.js rewrite proxy 对 SSE idle timeout | packing 阶段断连 | FR-04 每 5s yield keepalive 心跳 |
| reparse changes 1100 文件耗时长（未实测） | SSE 总时长不确定 | execute 实测；若 >60s 考虑分批或后台 |
| 多端并发 import 同 workspace | spec_root 覆盖竞争 | 前端按钮禁用 + 单用户假设（本期接受） |
| SSE 错误事件前端未处理 | 流异常无提示 | error 事件统一 setPageError |
| apply_sync 拆分影响现有 sync 端点契约 | sync 响应变 | DTO 加字段不删（向后兼容） |

## 13. 自审

- **需求覆盖**：AC-01（变更中心显 changes）← FR-01+FR-02；AC-02（无 proxy 500）← FR-03+FR-04；AC-03（离线容错）← FR-03；AC-04（容错）← FR-05；AC-05（sync 一致）← FR-06；AC-06（测试）← 全。✅
- **真实性**：apply_sync:489-505、ChangeService.reparse:668、SSE 范式 agent/router.py:447、打包 16.8s/reparse 2.7s 均代码/实测依据。✅
- **YAGNI**：不持久化/不流式 daemon/不优化 walkDir/不加锁（§10）。✅
- **决策可溯**：D-002 明确纠正 ql-003 误判（带上下文）。✅
- **遗留确认项**（execute 落实）：SSE 心跳间隔、apply_sync 拆分接口形态、reparse changes 实测耗时。✅
