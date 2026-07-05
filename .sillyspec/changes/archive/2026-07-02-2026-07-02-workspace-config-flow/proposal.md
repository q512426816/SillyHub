---
author: qinyi
created_at: 2026-07-02 09:59:36
---

# Proposal — 2026-07-02-workspace-config-flow（工作区配置流程重设计）

## 动机

工作区配置当前流程混乱：客户端路径首次填完即冻结、扫描谁都能重复触发、「初始化」按钮干的是服务器建容器而非下发配置到客户端、文档无明确的服务器权威/客户端缓存双向同步。用户提出清晰的逻辑链：初始化（领配置 + 拉文档）→ 扫描（一人扫其他人复用）→ 文档自动同步 → 工作区就绪；新成员只需初始化即可拉现成文档。

`WorkspaceMemberRuntime`（per-member binding）与 tar 整树文档通道已落地（commit e2f65d9a / f11e1770），但 scan/dispatch 未接线 per-member、持续双向同步被显式留作后续（daemon-client-spec-sync-strategy D-002 仅单次快照）。本变更接这个茬。

## 关键问题

1. 客户端路径首次绑定后无前端编辑入口。
2. 无「工作区已扫过」门禁，重复扫描浪费 agent 算力。
3. 「初始化」语义错位（建容器 vs 下发客户端配置），`.sillyspec-platform.json` 运行时代码不存在。
4. per-member 表未接线 scan/dispatch（仍按 user_id + workspace 全局列）。
5. 新成员「初始化 → pull 文档到本地缓存」路径不存在。
6. 文档无客户端缓存保鲜机制（agent 跑在客户端，本地文档会过期）。

## 变更范围（方案 A 任务驱动，4 Phase）

- **W1** per-member 接线 + 客户端路径可编辑（含 `WorkspaceDaemonSwitcher` per-member 化）。
- **W2** 初始化按钮重定义（init lease：下发 `.sillyspec-platform.json` + pull 文档）+ 扫描门禁。
- **W3** 文档持续双向缓存同步（整包 + spec_version 保鲜 + pull 前回灌本地改动）。
- **W4** 前端流程整合（三态引导）+ 三端测试。

## 不在范围内（显式）

- 不做增量 manifest 同步（D-001，整包 YAGNI）。
- 不改 tar transport 整树覆写语义（D-008 保留）。
- 不做 server-local 的 init 重定义 / strategy 选项（仅 daemon-client）。
- 不做扫描过期（D-004，count>0 即视为已扫）。
- 不改 sillyspec CLI `--spec-root` 语义 / daemon 缓存路径。

## 成功标准（可验证）

- 两成员各自绑定不同 daemon + 路径，scan 按 actor 路由（不读 workspace 全局列）。
- 已绑定成员能改自己的路径/daemon（per-member 编辑入口）。
- 初始化按钮 → daemon 写 `.sillyspec-platform.json` + pull 文档；`WorkspaceMemberRuntime.init_synced_at` 更新。
- 已扫工作区点扫描 → 409 + 提示，确认后重扫。
- 服务器无文档时初始化完成 → 提示「请先扫描」。
- 成员 A 重扫后 `spec_version` 递增；成员 B 下次任务前自动 pull。
- daemon 本地有未回灌改动时 pull 前 `postSpecSync` 回灌。
- 默认零回归：未初始化 / 无 force 行为与现状一致。
