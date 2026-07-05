---
author: WhaleFall
created_at: 2026-07-01 11:30:00
---

# requirements：spec-workspace import 异步化 + 变更中心补 change reparse

## FR-01 变更中心显示导入的 changes
daemon-client workspace 导入 spec 后，变更中心页面显示该 workspace 的 changes（含 archive 历史）。`apply_sync` 落盘后顺序调 `ScanDocService.reparse`（docs）+ `ChangeService.reparse`（changes，填 `Change` 表）。

## FR-02 import 恢复 changes 导入
撤 ql-20260701-003 的 `get_spec_bundle` `excludeNames:['changes']`。`packSpecDir` 仅保留 `excludeRuntime:true`（.runtime 含 worktrees 2.1G 必排）。

## FR-03 import 异步化（SSE 流式）
`POST /api/workspaces/{id}/spec-workspace/import` 返回 `text/event-stream`，分阶段推送：
`packing → packed{tar_bytes} → applying → reparsing_docs{parsed} → reparsing_changes{parsed} → done{spec_workspace}`。
daemon-client 离线/超时/remote 错误 → `error{code,message}` 事件并正常关闭流。

## FR-04 SSE 心跳保活
`packing` 阶段（daemon 打包 ~16.8s，期间不 yield 业务事件）每 5s yield `: keepalive` 注释行，防 Next.js rewrite proxy idle timeout 断连。

## FR-05 apply_sync 分阶段容错
SSE 模式下 `apply_sync` 拆为 apply（写盘）/ reparse_docs / reparse_changes 三步分别 await + yield 事件；单步失败设 `sync_status="dirty"` 并推该阶段 error，**流不中断**（docs 与 changes 独立，部分成功优于全失败）。

## FR-06 sync 端点一致
`POST /spec-workspace/sync`（daemon 上传 tar，仍 JSON）经 `apply_sync` 同样 reparse docs+changes；响应 `{ok, reparsed, reparsed_changes}`（`reparsed` 保留=docs，向后兼容）。

## FR-07 前端流式 import
`importSpecWorkspace` 绕过 `apiFetch`，用原生 `fetch(POST)` + `response.body`(ReadableStream) + `TextDecoder` 解析 `event:/data:` 行；import 按钮按事件更新阶段进度文本；`done` 后刷新 spec_ws + 触发变更中心数据重拉。

## 非功能
- daemon-client 物理限制不变：root_path 在宿主机，必须 daemon 读。
- 并发：前端按钮 import 中禁用；多端并发 spec_root 竞争风险已知（本期单用户假设，YAGNI 不加显式锁）。

## 验收标准（AC）
- AC-01 daemon-client workspace 导入后，变更中心显示 changes（含 archive）。
- AC-02 import 全程 SSE 推阶段事件，无 proxy 500（packing 阶段有心跳不断连）。
- AC-03 daemon 离线时 SSE 推 `HTTP_504_DAEMON_RUNTIME_OFFLINE` error 事件并正常关闭（不挂死）。
- AC-04 reparse docs/changes 各自失败时 `sync_status=dirty`，SSE 流继续到 done。
- AC-05 sync 端点上传 tar 后 changes 入 `Change` 表（变更中心有数据）。
- AC-06 spec_workspace 全模块 + change 模块测试通过；ruff/format/mypy 过；sillyhub-daemon vitest 过。
