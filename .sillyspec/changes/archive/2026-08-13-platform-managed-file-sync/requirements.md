---
author: qinyi
created_at: 2026-08-13 14:43:03
---

# 需求规约 — 平台管理 spec 文件增量同步

## 功能需求

### FR-01：增量推送（只推变化）
- 文件级增量，只推 add/update/delete/rename，不全量整树。
- 内容变化用 SHA-256 hash 判断。覆盖 D-003。

### FR-02：多写者乐观锁
- 推送带 base_version（文件级），服务器比对不符返 409 + 返回服务器当前版本，人工拍板。
- 不同文件互不冲突，同一文件过期推被拦。覆盖 D-001/D-004。

### FR-03：服务器权威清单（独立 spec_file_manifest 表）
- 服务器维护逐文件 hash + 版本 + 路径 + exists，存**独立 `spec_file_manifest` 表**（不复用 scan_documents，避开 scan_docs reparse 互扰）。
- 增量端点以该表为基准。覆盖 D-011。

### FR-04：软删除备份（move 出 spec_root）
- delete op 同步删除，文件移出 spec_root 到备份区（`<workspace 数据根>/spec-backups/`，build_bundle 拉不到），保留可找回。
- 过期删除被 409 拒（锁保护）。
- 软删明确为 move；备份区仅恢复文件内容，不恢复 Change 行工作流状态（取舍写明）。覆盖 D-002/D-008/D-010。

### FR-05：rename 显式 op
- 路径变化识别为 rename，旧 hash 相同不重传内容。
- 服务器移动文件 + 更新清单 path。覆盖 D-005。

### FR-06：`.runtime/` 移出增量范围
- 增量 payload 排除 `.runtime/*`（含 sillyspec.db），不做清单、不推送。
- 现状服务器 `.runtime/*` 垃圾 ScanDocument 行可选清洗。覆盖 D-006。

### FR-07：兼容
- 旧 tar 端点 `/spec-workspace/sync` 保留（首同步/回退）。
- daemon 首同步走旧 tar，之后走增量；增量不可用时回退旧 tar。
- 旧客户端/旧 daemon 仍可用。覆盖方案 A。

## 非功能需求

### NFR-01：迁移
- 新建 `spec_file_manifest` 表（path/content_hash/version/exists），有 migration。
- 历史无清单，首增量推 base_version=0 兼容（hash 兜底）。

### NFR-02：降级安全
- 增量端点失败/不可用时 daemon 回退旧 tar 端点，不阻塞。
- base_version 冲突时 409 + 返回服务器版，不静默覆盖。

### NFR-03：跨平台
- rename 路径处理兼容 Windows 大小写不敏感（R-02）。

### NFR-04：性能
- 本地清单缓存避免每次全量算 hash（R-05）。
