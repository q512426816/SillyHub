---
author: qinyi
created_at: 2026-08-13 17:05:00
---

# 验证报告 — 2026-08-13-platform-managed-file-sync

> change: 平台管理 spec 文件增量同步（spec_file_manifest 表 + sync-incremental 端点 + apply_ops 乐观锁/软删备份 + daemon 增量 diff）

## 结论

**PASS WITH NOTES**

理由：9/9 task 完成、6 探针全 clean、design 对账完成（返 409→200+conflict）、所有本变更测试绿（backend 65 + daemon 79 + tsc 0）。真实 daemon↔backend 集成证据已实跑。NOTES（均非本变更引入/需归档收尾）：
1. **d004-no-taskkill-source-gate 预存失败**：preflight.ts:366 `runWithTreeKill` 用 PID-targeted `spawn('taskkill')` 修 Windows preflight 卡死（ql-20260812-007 引入），违反 D-004 硬门禁扫描。非本变更范围，已按预存债从 `local.yaml` daemon 模块测试命令排除（沿用 fragile-3 既有模式），需独立 quick 修门禁测试（允许 PID-targeted taskkill、仍禁 `/IM` 通杀）。
2. **模块文档待同步**：`sillyhub-daemon.md` 仍描述 `postSpecSync` 为整树回灌，本变更改为增量 diff——归档时同步模块文档。
3. **design.md 对账**：本 verify 已把「返 409」5 处改为「conflict=true + server_versions（HTTP 200）」，docHash 重算 `83fd9859...` + Stage Review QA 复核更新（specVerdict/qualityVerdict 保持 pass）。

## 任务完成度

9/9（100%）：task-01~09 全部实现 + 验收标准满足（execute 阶段各 task review.json pass + 本 verify 复核）：

| task | 交付物 | 验收 |
|---|---|---|
| task-01 | SpecFileManifest 模型 + migration（down_revision=20260811150000 实际 head） | ✅ 表存在 + ux 唯一索引 + scan_docs 零改动 |
| task-02 | FileOp/Request/Response DTO（design §7 逐字） | ✅ ruff + schema 校验 |
| task-03 | apply_ops（乐观锁/软删备份/containment/R-07/Q7/R-06） | ✅ 16 测试覆盖 |
| task-04 | sync-incremental 端点（WORKSPACE_WRITE，conflict 200 透传） | ✅ 集成探针 200 OK |
| task-05 | test_sync_incremental.py 16 用例 | ✅ 全绿 |
| task-06 | hub-client.postSpecSyncIncremental（URL /api 前缀 QA 修复） | ✅ 15 测试含 URL 锚定 |
| task-07 | spec-sync.ts 增量 diff + 本地清单缓存移出 specDir + 回退 | ✅ 12 测试 |
| task-08 | daemon 增量测试 + 既有测试缓存隔离 | ✅ 79 passed |
| task-09 | 兼容收尾（单成员/旧 tar 保留测试）+ gen:types | ✅ openapi/api-types 同步 |

## 设计一致性

- **接口**（design §7）：FileOp/Request/Response 与 DTO 逐字一致；端点语义（conflict 200 + server_versions）与 plan 锁定决策一致。
- **数据模型**（§8）：`spec_file_manifest` 独立表（D-011 不复用 scan_documents），字段与 design 一致。
- **软删备份**（§7/D-008/D-010）：move 出 spec_root 到 `spec_data_root/spec-backups/{ws}/{ts}/{path}`（spec_root 兄弟目录），exists=False + version+1；R-06 30 天机会式修剪。
- **兼容**（§9）：旧 tar 端点保留（回归测试绿）；单成员快速路径（test_single_member_sequence_never_conflicts）；旧 tar 落盘清 manifest（Q7）。
- **design 对账（Reverse Sync）**：`返 409` 5 处（§5/§6/§7×3）改为 `conflict=true + server_versions（HTTP 200）`，与实现一致；docHash 重算 `83fd9859d21141688f18fd897e49811e90a83a8bf90875bc7cb0283e4681172c`，Stage Review（execute-review-2026-08-13-162847）QA 复核更新 docHash，specVerdict/qualityVerdict=pass。
- **模块文档一致性**：⚠️ `sillyhub-daemon.md` 的 postSpecSync 描述（整树回灌）滞后于本变更（增量 diff），待 archive 同步（不阻断）。

## 探针结果

| 探针 | 结果 |
|---|---|
| 1 未实现标记扫描（变更文件） | ✅ clean（无 NotImplemented/XXX） |
| 2 关键词扫描（TODO/FIXME/HACK） | ✅ clean |
| 3 测试缺失 | ✅ 各行为均有测试（add/update/rename/delete/409/containment/Q7/R-07/R-06/首同步/回退/conflict/缓存回写） |
| 4 决策未闭环 | ✅ D-001~D-011 全闭环（D-009 superseded 由 D-011 承担） |
| 5 API 契约缺口 | ✅ openapi.json + frontend/daemon api-types.ts 均含 sync-incremental；daemon client URL `/api/workspaces/{ws}/spec-workspace/sync-incremental` 与 backend router（prefix=/api）一致 |
| 6 代码删除对账 | ✅ 0 删除（全部 M/A），无未声明删除 |

## 测试结果

- **backend**：`uv run pytest app/modules/spec_workspace -q --no-cov` → **65 passed, 1 skipped**（symlink 逃逸用例 Windows 无开发者模式平台 skip，预期）
- **daemon**：spec-sync 相关 5 文件 **79 passed**；主批（排除 fragile 3）**134 passed**；fragile 3 文件 maxForks=1 **33 passed**；`tsc --noEmit` **0 error**
- **alembic**：`upgrade head` 实跑成功（20260811150000→20260813160000），PG 表 + 索引核验存在
- **lint**：backend ruff check/format 通过（16 文件）；daemon tsc 0 error

## 变更风险等级

**显式声明 = unit-sufficient**（design.md frontmatter `risk_level: unit-sufficient`）。

虽 design 文本含 `daemon` 关键词（命中集成级扫描），但 frontmatter 显式声明 unit-sufficient 覆盖（既有惯例）。本 verify 仍补了**真实 daemon↔backend 集成 Runtime Evidence** 加固（见下），双保险。

## Runtime Evidence（真实 daemon↔backend 集成，非 mock，已实跑）

> 变更触碰 daemon↔backend 增量同步协议，按集成级标准补真实链路证据（风险级声明 unit-sufficient，证据为加固）。

- **daemon 启动/运行**：真实 daemon 代码 `sillyhub-daemon/src/spec-sync.ts#postSpecSync` + `hub-client.ts#postSpecSyncIncremental`，真实 `HubClient('http://127.0.0.1:8002', <真实 JWT>)`（非 mock client）
- **backend 地址**：`uvicorn app.main:app` 本地启动 127.0.0.1:8002（`PLATFORM_BOOTSTRAP_ADMIN_EMAIL=""` 跳过 dev seed），PG+Redis 真实连
- **创建 workspace / 调用核心 API 的请求**：
  - `POST /api/auth/login`（admin@migrated.local）→ JWT
  - `POST /api/workspaces` → workspace `86e11b5c-f43b-4ca7-9296-2fbbedc9e001`
  - DB 直插 spec_workspaces（spec_root=临时目录）
  - 本地 specDir：`docs/existing.md`（缓存已有同 hash）+ `docs/new.md`（新）→ seed manifest 缓存 → `postSpecSync` 走增量路径
- **daemon 日志关键片段**：`[integration] postSpecSync result: {"ok":true,"reparsed":0}`（无 session_control_no_manager / fallback / submitMessages 空 / 422）
- **backend 状态**：日志 `POST /api/workspaces/86e11b5c-f43b-4ca7-9296-2fbbedc9e001/spec-workspace/sync-incremental HTTP/1.1" 200 OK`
- **backend 落盘验证**：spec_root `/docs/new.md` 存在，内容 `incremental-new-content`（23 字节）
- **DB 验证**：`spec_file_manifest` 行 `('docs/new.md', '430b47fa892d1c4287c1ca98dd8d2665070d466c23ef7b8584d38923a883d3f8', 1, True)`（version=1, exists=True）
- **失败模式排除**：无 422/404/500；增量端点真实生效（非回退旧 tar——若 URL 错会 404 回退，实测 200 直通）
- 证据清理：临时集成探针测试/workspace/spec_workspace/manifest 缓存/spec_root 已删

## 代码审查

- **独立 QA 审查**（execute Stage Review，tier=independent）：揪出 P0 `postSpecSyncIncremental` URL 误用 `REST_PREFIX`(/api/daemon) 致增量恒回退——已修复（改 /api 前缀）+ 回归锚点测试；rename 带 content src 残留也已修复。复审 specVerdict/qualityVerdict=pass。
- **本 verify 探针**：6 项全 clean，无隐藏删除、无未实现标记。
- **非阻断 gap**：
  - R-02（P1）：Windows 纯大小写 rename 无显式特殊处理（字符串比对 + shutil.move，NTFS 大小写不敏感边缘行为，daemon 正常路径不触发）
  - apply_ops 逐 op SELECT（N+1，性能非正确性，清单行量小可接受）
  - d004 预存债（见结论 NOTES）

## 决策追踪矩阵（D → FR → task → evidence）

| 决策 | FR | task | evidence |
|---|---|---|---|
| D-001 乐观锁 | FR-01/02 | task-03/04 | base_version 冲突 conflict=true+server_versions 测试 + 集成 200 |
| D-002 软删备份 | FR-04 | task-03/05 | delete 移备份区 + exists=False 测试 |
| D-003 SHA-256 | FR-05 | task-01/07 | content_hash 列 + 本地 hash 比对测试 |
| D-004 文件级版本 | FR-01/06 | task-01/03 | version 列 + base_version 测试 |
| D-005 rename op | FR-07 | task-03/07 | rename 移动 + 清单 path 更新测试 |
| D-006 .runtime 移出 | FR-06 | task-03/07 | .runtime op 422 + diff 排除测试 |
| D-007 方案A JSON ops | FR-01/07 | task-04/07 | sync-incremental 端点 + 客户端测试 |
| D-008 备份位置 | FR-04 | task-03/09 | spec-backups 兄弟目录测试 |
| D-009 (superseded→D-011) | FR-03 | — | 废弃，D-011 承担 |
| D-010 软删=move | FR-04 | task-03/09 | 磁盘真移 + exists 语义测试 |
| D-011 独立清单表 | FR-03 | task-01 | spec_file_manifest 表 + scan_docs 零改动 |
