---
author: WhaleFall
created_at: 2026-07-01 11:30:00
---

# proposal：spec-workspace import 异步化（SSE）+ 变更中心补 change reparse

## 问题

workspace（daemon-client）导入 spec 后两个问题：

1. **变更中心空**：`Change` 表无数据。双重根因——ql-20260701-003 误把 `changes` 从 daemon 打包中排除（spec_root 无 `changes/`）；且 `apply_sync` 落盘后只调 `ScanDocService.reparse`（docs），漏了 `ChangeService.reparse`（changes），即使导入 changes 也不入库。
2. **import 报 500**：含 changes（1100 文件/12M）时 daemon 打包实测 16.8s + WS 传 + reparse ≈ 22s > Next.js rewrite proxy 超时 → ECONNRESET 500（backend 实际成功，前端误报）。

## 方案（用户确认：SSE 流式）

- **daemon**：撤 ql-003 的 `excludeNames:['changes']`，恢复 changes 导入（含 archive）；`.runtime` 排除保留；`get_spec_bundle` 不改流式。
- **backend import**：`import_from_repo` 改 SSE（text/event-stream），分阶段推 `packing/packed/applying/reparsing_docs/reparsing_changes/done/error`；`apply_sync` 拆分顺序调 `ScanDocService.reparse` + `ChangeService.reparse`，各自容错（dirty）；daemon 错误透传 ql-001 错误码为 SSE error 事件。
- **backend sync 端点**：同步加 `ChangeService.reparse`（一致性），响应保留 `reparsed` + 新增 `reparsed_changes`。
- **frontend**：`importSpecWorkspace` 绕过 apiFetch，用原生 fetch + ReadableStream 解析 SSE；import 按钮显示阶段进度；done 后刷新变更中心。

## 影响模块

spec_workspace（import_from_repo / apply_sync / router）、change（ChangeService.reparse 被新增调用）、scan_docs（不变，仅被调用）、sillyhub-daemon（packSpecDir 撤 excludeNames）、frontend（spec-workspaces.ts + workspace 详情页）。

## 不在范围内（Non-Goals）

- 不改 daemon `get_spec_bundle` 为流式（D-004，WS RPC 保持 request-response）。
- 不改 `ScanDocService`/`ChangeService` 内部解析逻辑（只调用，不改解析）。
- 不引入 import 任务持久化（SSE 内存即可，不落 DB task 表）。
- 不优化 daemon `walkDir` 并行 stat（16.8s 在 60s timeout 内，留作后续）。
- 不加 workspace 级 import 互斥锁（前端按钮禁用 + 单用户假设，YAGNI）。
- 不向后兼容旧 `POST /import` JSON 响应（本项目未上线，CLAUDE.md 规则10）。

## 关键决策

- D-001 import 改 SSE（破坏 JSON 契约，前端必改）
- D-002 撤 ql-003 excludeNames changes（纠正误判，打包慢改由异步化解决）
- D-003 apply_sync 顺序 reparse docs+changes，各自容错（部分成功优于全失败）
- D-004 daemon get_spec_bundle 不流式（packing 阶段 SSE 占位 + 心跳保活）

详见 design.md。
