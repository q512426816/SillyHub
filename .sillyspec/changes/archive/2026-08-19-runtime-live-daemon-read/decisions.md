---
schema_version: 1
doc_type: decisions
change_name: 2026-08-19-runtime-live-daemon-read
author: qinyi
created_at: 2026-08-19T06:20:00+00:00
---

# 决策记录

## D-001@v1：daemon 离线/失败不回退平台快照

- **状态**：已确认
- **决策**：任何 RPC 失败（离线、超时、方法不存在、拒绝访问、路径不存在）直接按 explorer 错误映射抛 HTTP 错误，不回退到平台侧 `spec_ws.spec_root` 同步快照。
- **理由**：用户明确要求「直读对应工作区当前绑定的 daemon 展示」；保留快照回退会让页面同时存在两种 freshness 的数据，语义混乱，且已知快照滞后坑会复发。
- **影响**：无 binding 或 daemon 离线时页面不可用，但错误提示明确。

## D-002@v1：进度经 sillyspec CLI 只读 JSON 命令读取

- **状态**：已确认
- **决策**：daemon 侧通过 `spawn sillyspec progress dump --spec-dir <specCacheRoot> --json` 读取进度，不自行用 Node SQLite 解析 `sillyspec.db`。
- **理由**：① db 格式归 sillyspec 仓管，格式演进不锁死 daemon；② 与已有 `machine-interface.js` 的只读 JSON envelope 模式一致；③ 避免把 daemon Node 版本门槛从 20 提到 22.5+（node:sqlite 要求）。
- **风险**：跨仓发版协调（R-01），旧版 sillyspec 会报 `method_not_found`。

## D-003@v1：三类数据全部实时读 daemon

- **状态**：已确认
- **决策**：流水线进度、用户输入记录、步骤产物全部改为通过 daemon 实时读取。
- **理由**：统一页面数据源 freshness，避免同页数据新旧不一致。

## D-004@v1：鉴权复用 MemberBindingResolver 用户门控绑定解析

- **状态**：已确认
- **决策**：runtime 端点继续要求 `Permission.RUNTIME_READ`；绑定解析用 `MemberBindingResolver.resolve_member_binding_or_none(workspace_id, actor_user_id)`。
- **理由**：与 explorer 模块同构，用户只能读自己 binding 对应的 daemon 数据。
- **注意**：这是「当前用户绑定的 daemon」，不是 workspace 全局唯一 daemon；多成员可能绑定不同 daemon，行为与 explorer 一致。

## D-005@v1：daemon 侧新增独立 runtime.* RPC 命名空间

- **状态**：已确认
- **决策**：新增 `runtime_read_progress` / `runtime_read_user_inputs` / `runtime_list_artifacts` / `runtime_read_artifact` 四个 RPC 方法，使用 `runtime.` 前缀，与 `host_fs.*` / `explorer_*` 并列但独立。
- **理由**：不污染现有 `host_fs` 九方法契约；语义上属于运行时数据读取而非通用文件系统操作。

## Design Grill 审查修正

- **P0 修正（已修）**：原 design 中 sillyspec 命令错误地写了 `--workspace-id`；实际 sillyspec CLI 用 `--spec-dir` 定位 spec 根，已改为 `sillyspec progress dump --spec-dir <specCacheRoot> --json`。
- **P1 待实现决策**：错误映射当前计划复用 explorer 错误类，会暴露内部模块名且语义不一致。实现时改为新建 `Runtime*` 错误子类（如 `RuntimeNotBound` / `RuntimeDaemonOffline` 等），但保留 explorer 的映射逻辑。
- **P1 待实现决策**：权限保持 `Permission.RUNTIME_READ` 不变；无 binding 时 404。
- **P2 待细化**：大产物文件 timeout 阈值在实现阶段确定（建议 30s，与 explorer 文件读取一致）。
