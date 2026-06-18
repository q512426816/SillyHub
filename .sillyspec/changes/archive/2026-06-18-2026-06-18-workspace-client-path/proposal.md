---
author: qinyi
created_at: 2026-06-18 11:36:31
change: 2026-06-18-workspace-client-path
status: proposal
---

# Proposal — Workspace 支持 daemon 客户端路径

## 动机

当前 SillyHub 的 Workspace 只能接入「与 backend 同机（或路径共享）」的项目——`root_path` 必须是 backend 进程能直接读到的本地路径（生产靠 Docker `/host-projects` 挂载），创建时后端在进程内 `shutil.copytree(root_path/.sillyspec)` 扫描。用户希望**通过 daemon 客户端接入「daemon 所在客户端机器上」的项目**，而 backend 读不到客户端机器的文件系统。这打通了「代码在远端开发机/CI 机，SillyHub 部署在服务器」的真实部署形态。

## 关键问题（现有方案为何不够）

1. **路径不可达**：`root_path` 只能是 backend 本地路径。客户端机器上的项目（如 `qinyi-macbook` 上的 `~/IdeaProjects/xxx`）backend 完全读不到，无法创建 workspace。
2. **agent run 路由错位**：`dispatch_to_daemon` 现按 `_get_online_runtime(user_id)` 选「user 名下任一在线 runtime」（`placement.py:174`）。一个 user 有多 daemon 时，daemon-client 项目的 agent run 会被路由到「没有该代码的机器」，执行必然失败。
3. **无目录浏览能力**：daemon 现无任何对外文件 RPC（`protocol.ts` 仅 register/heartbeat/lease），前端无法让用户在客户端机器上选目录，只能盲填路径。

## 变更范围

- `workspaces` 表新增 `path_source`(server-local/daemon-client) + `daemon_runtime_id`(强绑)（D-004）
- daemon 新增 WS RPC 通道 + `list_dir`，前端树形浏览客户端目录（D-005），`allowed_roots` 白名单限界（D-002）
- daemon-client workspace 创建跳过 backend 本地扫描，scan 派给绑定 daemon 执行
- agent run 按 `daemon_runtime_id` 强绑路由，离线即失败提示（D-001）
- spec 服务器平台托管不变（D-003），daemon 执行时按需 `bundle` 拉取 / `sync` 回传（D-006）

## 不在范围内（显式清单）

- ❌ 不改 server-local workspace 现有行为（含其多 daemon 路由隐患 R-05）
- ❌ 不引入 daemon↔backend 双向 spec 同步引擎
- ❌ 不支持 path_source 创建后切换
- ❌ 不支持 workspace 绑定多个 daemon
- ❌ 不做 spec 回传的细粒度 diff/冲突合并

## 成功标准（可验证）

- 现有 server-local workspace 创建/扫描/agent run 行为**零变化**（兼容回归通过）
- 用户可在「daemon-client」模式下：选在线 daemon → 树形浏览其 allowed_roots 内目录 → 选定 root_path → 创建 workspace
- daemon-client workspace 的 agent run 被路由到**绑定 daemon**；该 daemon 离线时立即失败并提示目标 runtime
- daemon-client workspace 的 spec 列表/内容可正常在前端读取（真理源=服务器 spec_root）
- agent 执行后产生的 spec 变更回传服务器并可被 scan_docs reparse
- daemon-client 的 scan/bootstrap 由绑定 daemon 执行，产出回传服务器
- list_dir 对 allowed_roots 之外的路径返回 403
