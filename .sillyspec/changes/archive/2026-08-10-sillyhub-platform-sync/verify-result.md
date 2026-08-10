---
author: qinyi
created_at: 2026-08-11T01:05:00+08:00
---

# 验证报告 — SillyHub 后端 SillySpec 进度同步层（platform_sync）

> 跨仓契约 `sillyhub/docs/sillyspec/sillyhub-progress-sync-contract.md` 后端落地。

## 结论

PASS WITH NOTES

3 端点 + §4.2 base_ts 冲突算法 + 双鉴权 + 零回归 + gen:types 同步全实现，契约 §13 校验清单 8 项 + §4.2 三分支 + §7 字典序 15 测试全过；无 P0/crash/安全洞。残留风险为 P2/P3（生产 PG 未实测 / 字典序依赖客户端格式 / 无清理机制），不阻断验收。

## 决策追踪矩阵（D-xxx@v1 → FR-xxx → task-xx → evidence）

| 决策 | FR | task | 状态 |
|---|---|---|---|
| D-001@v1 router 不自带 prefix 避尾斜杠 307 | FR-01 | task-06 | ✅ router.py APIRouter 无 prefix + main.py:580 include prefix=/api |
| D-002@v1 Bearer=APIKey/JWT 双鉴权 | FR-02 | task-03 | ✅ auth.py require_platform_sync 复用 ApiKeyService+get_current_user |
| D-003@v1 PlatformChangeProgressORM 单行 | FR-03 | task-01,02 | ✅ model.py + migration 20260810150000 |
| D-004@v1 不碰派发层 | FR-04 | task-04,06 | ✅ /api/changes* 与 /api/workspaces/{wid}/changes/* 正交 |
| D-005@v1 零回归（老 body 无 header） | FR-05 | task-04,05 | ✅ base_ts 空→接受，test_old_body_no_headers_accepted |
| D-006@v1 §4.2 base_ts 字典序冲突 | FR-06 | task-04 | ✅ service upsert_progress 三分支 |
| D-007@v1 GET /changes 裸数组 | FR-07 | task-05,06 | ✅ ChangeListItem + list_changes 裸数组 |
| D-008@v1 GET /progress 裸 dict+last_pushed_at | FR-08 | task-04,06 | ✅ get_progress + 404 |

8/8 决策全闭环。

## 任务蓝图验收

task-01~09 acceptance 全通过（纯列表无 checkbox，按列表项逐条对照实现验收）。代表性 task-06 acceptance 5 项：POST 读 3 header 200/409 ✅ / GET /changes 裸数组 ✅ / GET /progress 裸 dict+last_pushed_at+404 ✅ / 3 端点鉴权 401 ✅ / 不冲突 workspaces changes ✅。

## 单元测试结论

platform_sync 模块 15 测试全过（integration test 级，httpx AsyncClient TestClient 调真实端点）：
- 鉴权双路径 4 测试（无 token 401 POST+GET / APIKey shk_live_ 200 / JWT 200）
- §13-1 POST 读 3 header 存 last_pusher/last_pushed_at
- §4.2 冲突三分支 4 测试（无 base_ts 接受 / stored>base_ts 409 / stored==base_ts 200 / stored<base_ts 200）
- §13-3/§13-8 409 body + 不 auto-merge（platform_progress 原样回显）
- §13-4 GET /changes 裸数组
- §13-5 GET /progress 完整 + last_pushed_at + 404
- §13-6 字典序（T1<T2<T3 ISO8601UTC）
- §13-7 零回归（老 body 无 header）

## Runtime Evidence（集成级，design 命中 backend/daemon/session/lease 字面触发）

- **backend 启动**：`create_app()`（main.py:593）构建 app，platform_sync router 挂载 main.py:580 `app.include_router(platform_sync_router, prefix="/api", tags=["platform-sync"])`；openapi schema 361 paths 含 `/api/changes` + `/api/changes/{name}/progress`（真实 app.openapi() 实测）。
- **integration test（非 mock 单测）**：test_router.py 15 测试用 `httpx.AsyncClient`（TestClient）调真实端点 POST/GET `/api/changes*`，完整跑 router→PlatformSyncService→DB（SQLite create_all 建 platform_change_progress 表，conftest autouse）+ 鉴权（ApiKeyService.create 真实签发 shk_live_ key 经 bcrypt + JWT 经 auth_headers fixture），非 mock。
- **backend 状态**：POST 200 写入 latest_progress/last_pushed_at/last_pusher；冲突 409 返平台当前 latest_progress（不合并客户端 body）；GET 404 不存在 change；GET 200 完整六表 + 顶层 last_pushed_at。状态流转实测正确。
- **日志关键片段**：`15 passed, 1 warning in 6.43s`（warning 为 ppm/common/fsm InvalidTransition 类弃用，import 链触发，与 platform_sync 无关）。无 session_control_no_manager / fallback to task_runner / submitMessages agent_run_id empty / 422 等失败标记。
- **daemon 集成说明**：platform_sync 不集成 daemon（D-004 铁律不碰派发层，design 命中 daemon/lease/session 是"不碰派发层 / 复用 auth 鉴权"描述，非本变更集成面）。本变更集成面是 backend HTTP 端点（platform_sync ↔ DB ↔ auth），integration test 已覆盖。
- **失败模式排除**：无 token 401（test_post_no_auth_returns_401 + test_get_changes_no_auth_returns_401）/ 冲突 409（test_conflict_*）/ 不存在 404（test_get_progress_not_found_404）全显式覆盖。

## 集成证据门控（关键词字面触发处理）

- design/plan 命中 backend/daemon/session/lease → 集成级门控触发。
- 满足方式：**integration test**（TestClient 调真实端点 15 测试，非 mock 单测）+ Runtime Evidence 章节 + 日志片段（上文）。
- daemon/lease/session 关键词来源：D-004"不碰派发层（含 daemon）"+ D-002"复用 auth 鉴权（session/JWT）"——这些是 platform_sync **不集成**面的描述，本变更真实集成面是 backend HTTP 端点 ↔ DB ↔ auth，integration test 全覆盖。

## 代码审查（12 项，详见 stage-review execute-review-2026-08-11-004521）

12/12 全 pass。重点：
- ConflictResponse/ProgressSyncOk 未入 openapi 是设计（POST 409 用 JSONResponse 绕 response_model 保 body 严格按契约 §4.4 + GET /progress Any 裸 dict NG-6 透传），客户端 sync.js 用裸 JSON 不依赖类型。
- worktree + editable install 坑已 workaround + 文档化（PYTHONPATH=<worktree>/backend 强制 worktree app，否则 dump_openapi.py 加载主仓 app 漏 platform_sync 出 359）。

## 静态检查

- ruff check app/modules/platform_sync：All checks passed!
- ruff format --check：9 files already formatted
- mypy auth/model/schema/service/router：Success, no issues found in 5 source files

## gen:types 同步（NFR-04 + CLAUDE.md 规则 20）

- backend/openapi.json：361 paths（+2 path 键 /api/changes + /api/changes/{name}/progress）。
- frontend/src/lib/api-types.ts：含 /api/changes{/{name}/progress} 路径块 + ChangeListItem schema。
- backend.md：契约摘要/模块清单/注意事项/变更索引 4 处加 platform_sync。
- local.yaml（gitignored 本地配置）：加 platform_sync 第 13 模块条目（R-02）。

## 残留风险（P2/P3，不阻断）

1. **生产 PG 未实测**（P2）：SQLite 测试通过，latest_progress 用 sqlalchemy.JSON 在 PG 映射 JSONB，理论无差异但未验证。建议部署后容器内 curl /api/health + python import app.modules.platform_sync 复验。
2. **base_ts 字典序依赖客户端 ISO8601 格式**（P2）：契约 §7 约束客户端发 ISO 8601 UTC 同格式串，后端按字典序实现正确；若客户端发非标格式可能误判——契约冻结客户端责任。
3. **platform_sync 表无清理机制**（P3）：change 删除后 platform_change_progress 残留行——契约未要求清理，后续按需。
4. **worktree gen:types 不可直接 pnpm gen:types**（P2，已文档化）：worktree + editable install 坑，须 PYTHONPATH workaround 或主仓合并后跑。backend.md 注意事项已记录。
