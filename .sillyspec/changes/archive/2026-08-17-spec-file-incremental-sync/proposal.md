---
author: qinyi
created_at: 2026-08-17 08:52:32
---

# 提案（Proposal）— CLI 直跑 spec 文件增量同步

## 一句话

给本地直接运行 sillyspec 的场景补上**文件树增量同步**：每步 `--done` 后，CLI 自动把本地 `.sillyspec/` 树与服务器比对，只推送变化文件到平台，不再需要手动点击「同步到服务器」或依赖 daemon 缓存。

## 问题

- 详情页「文档卡」已通过 2026-08-16-auto-sync-from-repo 自动更新；
- 但详情页「变更文件」树在 CLI 直跑时仍依赖 daemon 缓存/手动按钮，经常出现「进度到了、其他文件没到」或「文件树是旧快照」。
- daemon ↔ 后端链路已有完整增量同步能力，但 CLI 直跑场景没有入口。

## 方案

在 `platform_sync` 层新增两个 shpsync_ 鉴权端点：
- `GET /api/changes/spec-manifest`：返回服务器 `spec_root` 的权威清单；
- `POST /api/changes/spec-sync`：接收 `FileOp[]`，内部复用 `spec_workspace.apply_ops` 落盘。

CLI `sync()` 成功后追加 `syncSpecTree()`：读清单 → walk 本地树 → sha256 diff → 生成 add/update/delete/rename ops → POST ops；无差异短路，失败不阻塞主流程。

## 不在范围内

- 不替换 daemon 现有增量链路。
- 不替换四件套直推（文档卡独立）。
- 不做自动冲突合并（保持乐观锁人工拍板语义）。
- 不在 CLI 侧持久化清单缓存。

## 预期收益

- CLI 直跑 sillyspec 后，平台文件树自动保持最新；
- 只传差异，量小、快、可观察；
- 与 daemon 链路共享同一套清单/乐观锁协议，维护一致。
