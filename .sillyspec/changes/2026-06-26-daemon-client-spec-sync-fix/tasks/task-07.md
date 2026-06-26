---
author: qinyi
created_at: 2026-06-26 11:36:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-06, FR-07]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/spec_workspace/service.py
---

# Task-07 — backend apply_sync 接收 daemon `.runtime` + 落 last_synced_at

## 目标

把 `apply_sync`（push，daemon→backend）从「preserve backend `.runtime`（备份+恢复覆写）」改为「接收 tar 内 daemon 的 `.runtime/`」，并在成功后落 `last_synced_at=now()` / `sync_status='clean'`。与 task-06（`packSpecDir` 改为包含 `.runtime`）共同构成 D-003@v1 的非对称契约：**push 包含 `.runtime`、pull 仍排除 `.runtime`**。

依据：design §5.2（D-003 runtime 两端）+ §7.5 生命周期契约表（scan 终态 sync → `last_synced_at ← now`）；plan task-07（覆盖 FR-06, FR-07）。

## implementation

文件：`backend/app/modules/spec_workspace/service.py`，只动 `apply_sync`（288-403）：

1. **删除 runtime_bak 保留逻辑**：
   - 删 `runtime_bak: Path | None = None`（318）。
   - 删「Preserve .runtime/」段（344-348）：不再把 `spec_root/.runtime` move 到 `runtime-bak-*` 临时目录。
   - 删「Restore .runtime/」段（362-365）：不再把备份的 `.runtime` move 回 `spec_root/.runtime`。
   - 删 `finally` 内 `runtime_bak` 清理分支（369-370）。
   - 清空 spec_root（351-355）+ 搬入新树（358-359）保持原样——daemon tar 内的 `.runtime/` 随整树覆盖落盘（D-006@v1 whole-tree overwrite）。
2. **docstring 更新**：把「`.runtime/` is preserved」改为「接收 tar 内 daemon 的 `.runtime/`（daemon 是 daemon-client 唯一 sillyspec 执行方，.runtime 权威）」，对齐 D-003@v1 非对称语义。
3. **`build_bundle` 不动**（245-286）：pull 路径仍排除 `.runtime`（backend 的 .runtime 非权威，不污染 daemon）。
4. **last_synced_at / sync_status 已现成**：现有 374-378 已在 `extractall`+搬入成功后落 `sync_status='clean'`、`last_synced_at=now()`、`commit()`——确认保留即可（FR-07）。reparse 失败翻 `dirty` 的分支（386-395）也保留。

## acceptance

- `apply_sync(tar 含 .runtime/)` 后，`spec_root/.runtime/` 内容来自 daemon tar（backend 旧 `.runtime` 被整树覆盖，不再保留）。
- `apply_sync` 成功后 `spec_workspaces.last_synced_at` 非 NULL、`sync_status='clean'`（已有逻辑，回归守护）。
- `build_bundle` 仍排除 `.runtime`（pull 路径排除不变，非对称）。
- Tar Slip 防护（绝对路径/盘符/越界校验 320-336）+ staging 原子交换（extractall 到 staging 再覆盖 spec_root）保持有效。

## verify

```
cd backend && uv run pytest tests -k "spec_workspace or apply_sync or sync"
```

聚焦 `apply_sync` 相关用例（含 `.runtime` 接收、`last_synced_at` 落库、Tar Slip 防护、double-sync 幂等）。如缺 `.runtime` 接收覆盖用例，本任务范围内补一条（allowed_path 内 service 测试可同改或同目录测试文件补）。

## constraints

- 只改 `apply_sync` 的 `.runtime` 处理与 `last_synced_at`/`sync_status`；不动 `build_bundle` 的 `.runtime` 排除（非对称是契约，不是疏漏）。
- 保留 Tar Slip 防护（路径校验 320-336）与 staging 原子交换（先 extractall staging、再清空+搬入 spec_root）。
- `import_from_repo` / `sync` / `update_sync_status` 等 stub 方法不动。
- 兼容 server-local / repo-native：`apply_sync` 对两种 transport 均适用（端点 `/spec-workspace/sync` 不读 strategy），改动不影响 shared 默认路径回归。
