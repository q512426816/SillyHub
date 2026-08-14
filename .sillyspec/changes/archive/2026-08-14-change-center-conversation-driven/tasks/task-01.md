---
id: task-01
title: daemon spec-sync incremental change_dirs annotation
title_zh: daemon 增量同步 change_dirs 标注
author: qinyi
created_at: 2026-08-14 15:46:49
priority: P0
depends_on: []
blocks: [task-02]
requirement_ids: [FR-01a]
decision_ids: [D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/spec-sync.ts
  - sillyhub-daemon/src/hub-client.ts
provides:
  SpecIncrementalSyncRequest.change_dirs:
    fields: [change_dirs]
goal: >
  让 daemon 在增量同步时把「本次涉及哪些变更目录」显式标注给 backend，使 backend 能精确触发
  scoped reparse（命门 P1 链路的上游）。只改 daemon 侧两个文件，不碰 backend。
implementation:
  - sillyhub-daemon/src/spec-sync.ts：在 computeIncrementalOps 或 postSpecSync 附近，从本次增量 ops 中
    提取 change_dirs——对每个 op 路径取 `changes/<name>/` 或 `changes/archive/<name>/` 前缀分组的 key
    （去掉 `changes/` 与 `changes/archive/` 前缀、取第一段目录名），去重成 string[]。注意归档路径
    （`changes/archive/<name>/`）同样归入该 name（design §5 P1：归档路径命中 backend 走全量 reparse，
    daemon 侧只需把 name 传上来即可，backend 判定路径是否含 archive 段）。非 changes 路径的 op 不进 change_dirs。
  - sillyhub-daemon/src/hub-client.ts：postSpecSyncIncremental（:966，现 body 仅 `{ops}`）签名与 body
    加 `change_dirs: string[]` 参数（默认 []），透传给 backend sync-incremental 端点。注意现有调用方
    （spec-sync.ts 内调用 postSpecSyncIncremental 处）同步传入计算好的 change_dirs。
  - 保持 best-effort：change_dirs 计算失败/异常时降级为 []（backend 有前缀检测兜底），不阻断同步主流程。
acceptance:
  - spec-sync.ts 计算出 change_dirs（非空时含本次新增/修改的 `changes/<name>/` 下文件的 name）
  - hub-client.ts postSpecSyncIncremental 签名带 change_dirs，请求体含该字段
  - 现有增量同步流程不回归（无 change_dirs 时后端仍能兜底）
  - cd sillyhub-daemon && pnpm typecheck 通过
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - 检查 hub-client.ts postSpecSyncIncremental 调用链与 spec-sync.ts 传参
constraints:
  - 只改 daemon 侧（spec-sync.ts + hub-client.ts），不碰 backend（backend 在 task-02 接）
  - change_dirs 缺省 []，兼容旧请求
  - 归档路径（changes/archive/）前缀也归入 change_dirs（backend 在 task-02 判定 archive → 全量）
  - daemon ESM import 必须带 .js 扩展名（CONVENTIONS daemon 约定）
  - 与在途 2026-08-13-spec-sync-visibility 在 spec-sync.ts 改点重叠：功能共存，不回退其改动
---
