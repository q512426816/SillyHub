---
author: qinyi
created_at: 2026-06-26 10:56:38
---

# Proposal — daemon-client workspace spec 树同步修复

## 动机

daemon-client workspace（`root_path` 在客户端机器、backend 不可直读）的数据通路当前断裂：scan run 已完成但 scan-docs/knowledge/runtime 全空，changes 新建直接报错。实测 workspace `7cd27eb9`（myaaa，绑定在线 claude daemon）scan run `453530e9` 已 completed，而 backend 容器 spec_root 空目录、`scan_documents=0`、`spec_workspaces.last_synced_at=NULL`——daemon 本地盘却有完整产物。daemon-client 这类工作区在 backend-in-Docker / daemon-on-host 不共享 FS 的部署下，数据交换唯一依赖 tar 同步，而该链路在契约、时机、写通路三处均有缺陷，导致整个工作区类型不可用。

## 关键问题（为什么现有方案不够）

1. **spec 树回灌只在 session end 触发，而 interactive scan session 长期不 end**：scan 跑在 interactive session（永不过期，生命周期由 end_session 管），run 完成不等于 session 结束。用户扫完看不到结果——必须手动结束会话或等不知何时才触发，UX 断裂。run 状态回传（notifyRunResult）与 spec 树回灌（postSpecSync）是两条独立链路，"run completed" 误导性地让人觉得同步已完成。

2. **daemon↔backend 对 `.sillyspec` 包裹层契约不一致**：daemon 本地 spec 布局扁平（`<specroot>/docs/...`），backend 读取层却找 `<specroot>/.sillyspec/docs/...`。即便触发 sync，parser 照样 `parsed:0`。这是 `2026-06-23-spec-transport-tar-sync` 引入后未对齐的系统性缺陷，影响 scan-docs/knowledge/runtime 全部读取端。

3. **daemon-client 写 change 没有可用通路**：`change_writer` 对 daemon-client 抛 `requires an active lease`，但所指 worktree lease 走服务端 `git worktree add`——daemon-client 仓库在客户端机，服务端无仓库，该机制根本不适用。用户从 UI 新建 change 直接撞墙，且报错无引导。

## 变更范围

- **P1 契约对齐**：`SpecPathResolver` 增 `platform_managed` mode；全 reader（scan_docs/runtime/spec_workspace/knowledge/service 重定向/validator/post_scan_validator）+ context_builder prompt 按 mode 适配。
- **P2 sync 时机 + runtime 可见**：scan run 终态触发 postSpecSync（抽 `syncSpecTreeIfNeeded`，保留 session-end 兜底）；`apply_sync` 接收 `.runtime` + `packSpecDir` 不再排除 `.runtime`；落 `last_synced_at`。
- **P3 daemon 代写 change**：lease-polling 机制（backend proxy 端点 + `daemon_change_writes` 任务队列 + daemon task-runner 轻量分支 claim→本地写→sync）；`change_writer` daemon-client 走 proxy，无 daemon 抛结构化错误 + 前端引导。

## 不在范围内（显式清单）

- 不改 sillyspec CLI 的 `--spec-root` 目录布局语义。
- 不改 daemon 本地 spec 存储路径（扁平布局保留，不做数据迁移）。
- 不引入 daemon↔backend 文件系统共享（bind mount）；继续走 tar 同步。
- 不改 batch daemon-client（task-runner）既有 spec 同步语义（聚焦 interactive scan + change 读写）。
- 不做 change 写入的 git worktree 化（daemon 代写仅落 `.sillyspec/changes/<key>/` 文件）。
- 不改 server-local / repo-native workspace 的既有行为（零回归）。

## 成功标准（可验证）

- SC1：daemon-client workspace scan run 到终态（completed/failed）后，无需手动结束 session，`GET /scan-docs` 立即返回扫描产物（`scan_documents > 0`，覆盖 ARCHITECTURE/CONVENTIONS/STRUCTURE 等），`GET /knowledge` 返回知识条目，`GET /runtime` 返回 RuntimeProgress（含 sillyspec.db 进度）。
- SC2：backend `spec_workspaces.last_synced_at` 在 scan 终态后非 NULL，`sync_status=clean`。
- SC3：server-local / repo-native workspace 的 scan-docs/knowledge/runtime 行为与修复前一致（`.sillyspec` 包裹语义不变，`platform_managed` 默认 False）。
- SC4：daemon-client workspace 在绑定 daemon 在线时，从 UI 新建 change 成功（文件落到 daemon 本地 `.sillyspec/changes/<key>/` 并回灌，`Change` 行落库）。
- SC5：daemon-client workspace 在 daemon 离线时新建 change，返回结构化 `DAEMON_CLIENT_NO_SESSION`（http 400）而非裸抛 `requires an active lease`，前端给出引导。
- SC6：真实环境联调（backend Docker `multi-agent-platform-backend-1` + 宿主 daemon）用 workspace `7cd27eb9` 验收 SC1/SC2/SC4 端到端通过。
- SC7：Windows/Linux/macOS 三平台 daemon 路径兼容（`homedir()`，既有约束）。
