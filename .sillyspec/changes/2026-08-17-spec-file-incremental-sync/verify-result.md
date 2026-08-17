---
author: qinyi
created_at: 2026-08-17 21:25:00
---

# 验证报告 — 2026-08-17-spec-file-incremental-sync

## 结论

PASS WITH NOTES（含真实 Runtime Evidence，见下；NOTE 为 P2 观察项，不阻断）

## 任务完成度

| 任务 | 状态 | 证据 |
|---|---|---|
| task-01 GET /api/changes/-/spec-manifest | 完成 | worktree f6136de3；pytest TestManifestAndSync 通过 |
| task-02 POST /api/changes/-/spec-sync | 完成 | worktree 36913ac3；TestOps/TestConflict 通过 |
| task-03 鉴权与跨模块测试 | 完成 | worktree 724fc249；test_spec_sync.py 11 用例（401/403/200/冲突/空 ops/越界） |
| task-04 walkSpecTree/hashFiles | 完成 | sillyspec 仓 6755789→6647e176；排除口径+POSIX 断言通过 |
| task-05 computeSpecOps | 完成 | 同上；add/update/delete/rename 四 op 映射断言通过 |
| task-06 syncSpecTree 组装 | 完成 | 同上；无差异短路/conflict 不抛/404 静默断言通过 |
| task-07 sync.js 接入 | 完成 | 同上；platform-sync-push-header 测试回归通过 |
| task-08 CLI 测试 | 完成 | 同上；platform-spec-sync-incremental.test.mjs 4 组断言 |
| task-09 gen:types | 完成 | worktree 1eee51c1；openapi.json 370 paths + api-types.ts，tsc 0 错误 |
| task-10 回归+模块文档 | 完成 | worktree b04f3024（sillyspec.md+backend.md）；三套回归全绿 |

## 设计一致性

- 端点路径带 `-` 占位段避开 `{name}` 贪婪匹配（design §5.2）：router 中 `/changes/-/spec-manifest` 声明先于 `/changes/{name}/progress`，实测清单/同步均命中专用端点。
- 鉴权复用 `require_platform_sync_write`（仅 shpsync_；JWT/shk_live_ 403）：pytest TestAuth 三分支覆盖。
- CLI 以服务器清单为锚（无本地缓存）：spec-sync.js GET manifest → walk/hash/diff → POST ops，与 design §5.4 一致。
- 排除口径与 daemon 对齐：`UPLOAD_EXCLUDE_TOP_BASE`/`UPLOAD_PRUNE_NAMES_BASE` 逐字复刻 sillyhub-daemon/src/spec-sync.ts。
- 错误降级：未连接/404/网络 → 静默（debugLog）；conflict → console.warn 不阻塞主流程（sync() 返回 synced=1 不抛）。
- 契约零破坏：既有四件套直推与进度上行顺序不变（sync.js :457-475 注释链）。

## 探针结果（Runtime Evidence — 真实执行）

真实 uvicorn（worktree tip b04f3024，`/api/health` 返回 commit_sha=b04f30242a7f 自证跑的是本分支代码）+ 真实 CLI SyncManager（sillyspec 仓 6647e176）+ 真实 SQLite 落盘，端口 8791 全链路：

1. **首推全量 add**：fixture（四件套 + module-impact.md + verify-result.md + tasks/task-01.md）首次 `sync()` → `[spec-sync] 已同步 8 个文件变更`；服务器 landing 树落盘 8 文件（含四件套之外文件——证明整树同步非仅四件套）。
2. **无差异短路**：无改动再 `sync()` → `[spec-sync] 无差异，跳过同步`，不发 POST /spec-sync（SILLYSPEC_DEBUG_SYNC=1 可见）。
3. **单文件增量**：仅 plan.md 追加一行再 `sync()` → `[spec-sync] 已同步 1 个文件变更`；GET /spec-manifest 实测 `plan.md:v2`，其余 7 文件全部 `v1`——请求体只含该文件 op（design §6 验收 #2）。
4. **落盘内容正确**：landing/changes/.../plan.md 内容为 v1 + 追加行（utf-8 无损）。

## 测试结果

| 套件 | 结果 |
|---|---|
| backend worktree pytest（platform_sync + spec_workspace） | **182 passed, 1 skipped**（skip=Windows symlink 平台限制，预存） |
| frontend vitest（main 仓，api-types.ts 再生成后） | **157 files / 1610 tests 全过** |
| frontend tsc --noEmit | **0 错误** |
| sillyspec 仓 npm test | **218 files / 0 failures**（含新增 platform-spec-sync-incremental） |

## 变更风险等级

- **风险**：低-中。新端点仅 shpsync_ 可达（fail-closed），CLI 同步 best-effort 不阻塞主流程；老后端 404 时静默跳过（mock 测试覆盖）。
- **P2 观察项（NOTE）**：`local.yaml` 本身在 `.sillyspec/` 树内且不在排除清单 → 会被整树同步到服务器 landing 树（内含 shpsync_ token）。与 daemon 排除口径逐字一致（daemon 同样上传 local.yaml），非本次新引入的暴露；但 token 落服务器文件树值得后续评估是否加入排除清单（可走 quick）。
- **遗留**：无 daemon 部署面改动（daemon 已有增量同步，本次补 CLI 直跑缺口）；npm 发版 sillyspec 新版本由用户决定时机（既有惯例）。
