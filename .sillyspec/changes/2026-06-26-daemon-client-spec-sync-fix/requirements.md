---
author: qinyi
created_at: 2026-06-26 10:56:38
---

# Requirements — daemon-client workspace spec 树同步修复

## 角色表

| 角色 | 说明 |
|---|---|
| 平台用户 | 在 UI 对 daemon-client workspace 发起 scan、查看 scan-docs/knowledge/runtime、新建 change |
| daemon（sillyhub-daemon） | 跑在客户端机器，执行 scan、写本地 spec 树、轮询 change-write 任务、回灌 spec 树 |
| backend（FastAPI） | 跑在 Docker，托管 spec_workspaces 镜像、读 scan-docs/knowledge/runtime、转发 change-write 任务、提供 proxy 端点 |

## 功能需求

### FR-01（P1，B）：platform-managed spec_root 契约
SpecPathResolver 支持 `platform_managed` mode；`strategy=platform-managed` 时 spec_root 即 `.sillyspec` 内容根（扁平），`docs/`/`changes/`/`.runtime/`/`projects/`/`knowledge/` 直接在其下。

- **Given** 一个 `strategy=platform-managed` 的 spec_workspace
- **When** 任一 reader（scan_docs/runtime/spec_workspace/validator/knowledge）经 `SpecPathResolver.for_spec_workspace(spec_ws)` 解析路径
- **Then** 解析结果不含额外 `.sillyspec` 段（如 `scan_dir = spec_root/docs/<project>/scan`）

### FR-02（P1，B）：server-local/repo-native 零回归
- **Given** 一个 `strategy != platform-managed`（server-local/repo-native）的 workspace
- **When** reader 解析路径
- **Then** 行为与修复前一致（保留 `<root>/.sillyspec/` 包裹，`platform_managed` 默认 False）

### FR-03（P1，B）：knowledge 读根重定向
- **Given** daemon-client（platform-managed）workspace
- **When** 调 `GET /api/workspaces/{wid}/knowledge`
- **Then** 从 `spec_ws.spec_root`（platform-managed mode）解析，不再读不可达的 `workspace.root_path`

### FR-04（P1，B）：prompt 一致化
- **Given** platform-managed workspace 的 scan agent prompt
- **When** backend 构造 prompt
- **Then** 指示文档生成在 `<specroot>/docs/`（不含 `.sillyspec`），与扁平产出一致

### FR-05（P2，A）：scan run 终态回灌
- **Given** daemon-client workspace 的 scan interactive run
- **When** run 到达终态（`status in (completed, failed)`）
- **Then** daemon 自动触发 `syncSpecTreeIfNeeded` 把本地 spec 树回灌 backend（不依赖 session end）；session end 仍作兜底

### FR-06（P2，runtime）：.runtime 双端同步
- **Given** daemon-client workspace
- **When** daemon postSpecSync（push）
- **Then** tar **包含** `.runtime/`（packSpecDir 不再排除）；backend `apply_sync` **接收并覆盖** `.runtime/`（不再 preserve-overwrite）；`build_bundle`（pull）仍排除 `.runtime`
- **And** `GET /runtime` 返回 sillyspec.db 反映的 RuntimeProgress

### FR-07（P2）：last_synced_at 落库
- **Given** apply_sync 成功
- **When** sync 完成
- **Then** `spec_workspaces.last_synced_at = now()`，`sync_status=clean`

### FR-08（P3，C）：daemon 代写 change（在线）
- **Given** daemon-client workspace 且绑定 daemon `status=online`
- **When** 用户经 `POST /changes/proxy-create`（带 runtime_id）新建 change
- **Then** backend 创建 `daemon_change_writes` 任务（pending），daemon 轮询 claim → 本地写 `.sillyspec/changes/<key>/` → 回执 → 触发 sync → backend 落 `Change`+`ChangeDocument` 行；前端收到成功

### FR-09（P3，C）：无 daemon 结构化错误
- **Given** daemon-client workspace 且 daemon 离线/未绑定
- **When** 用户尝试新建 change
- **Then** 返回 `DAEMON_CLIENT_NO_SESSION`（http 400，含引导文案），前端 toast；不再裸抛 `requires an active lease`

### FR-10（P3，C）：change-write 不启 agent
- **Given** daemon claim 到 `kind=change-write` 任务
- **When** 执行
- **Then** 仅做本地文件写 + postSpecSync，不启动 agent run（与 batch agent-run lease 区分）

## 非功能需求

- **NFR-01 兼容性**：Windows / Linux / macOS（daemon 路径用 `os.homedir()`，既有约束）。
- **NFR-02 幂等**：scan 终态 sync 与 session-end sync 可能重复，`apply_sync` 整树覆写须幂等，无副作用。
- **NFR-03 超时兜底**：`daemon_change_writes` pending 超时（建议 60s）→ failed，前端可重试，不堆积。
- **NFR-04 安全**：change-write 文件路径做 traversal 校验（`changes/<key>/` 内），与 apply_sync Tar Slip 防护对齐。
- **NFR-05 权限**：proxy-create 复用 WORKSPACE_WRITE 权限；daemon 轮询端点复用 runtime 鉴权（X-API-Key / Bearer）。

## D-xxx@vN 覆盖关系

| 决策 | 覆盖 FR |
|---|---|
| D-001@v1 scope=A+B+C+runtime 全修 | FR-01~FR-10 |
| D-002@v1 scan 终态即回灌（保留 session-end 兜底） | FR-05, FR-07 |
| D-003@v1 .runtime 纳入 push 同步（pull 仍排除） | FR-06 |
| D-004@v1 daemon 代写 change 经 lease-polling（daemon 无 HTTP server） | FR-08, FR-09, FR-10 |
| D-005@v1 SpecPathResolver platform_managed mode（backend 读端适配，方案 A） | FR-01, FR-02, FR-03, FR-04 |
