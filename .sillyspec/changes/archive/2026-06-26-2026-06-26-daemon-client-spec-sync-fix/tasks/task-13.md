---
author: qinyi
created_at: 2026-06-26 11:36:00
priority: P0
depends_on: [task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11, task-12]
blocks: [task-14]
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09, FR-10]
decision_ids: [D-002@v1, D-003@v1, D-004@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/spec_workspace/tests/
  - backend/app/modules/scan_docs/tests/
  - backend/app/modules/runtime/tests/
  - backend/app/modules/knowledge/tests/
  - backend/app/modules/change_writer/tests/
  - backend/app/modules/daemon/tests/
  - backend/app/core/tests/
  - backend/tests/
  - sillyhub-daemon/src/__tests__/
---

# task-13 — Phase 1-3 单测/集成测（覆盖 FR-01~FR-10, NFR-02~04）

## goal

为 task-02~task-12 的实现补齐自动化测试守护，确保 daemon-client workspace spec 树同步修复三 Phase（契约对齐 / sync 时机+runtime / daemon 代写 change）行为正确，且 server-local/repo-native 零回归。覆盖 FR-01~FR-10 + NFR-02（double-sync 幂等）/ NFR-03（change-write 超时→failed）/ NFR-04（path traversal 拒绝）。

依据：design §10 测试策略（三 Phase 单测/集成测清单）+ §11 风险（R1 漏 reader 由 mode 单测覆盖）+ 全局验收（local.yaml backend/daemon 测试通过、double-sync 幂等、超时兜底）；plan task-13 覆盖矩阵。

## allowed_paths

backend 各模块 `tests/`（`backend/app/modules/*/tests/`、`backend/tests/`、`backend/app/core/tests/`）+ `sillyhub-daemon/src/__tests__/`。仅写测试，不改被测逻辑。

## implementation

### Phase 1 测（契约对齐，FR-01~FR-04，D-005@v1）
1. **SpecPathResolver mode 单测**（`backend/app/core/tests/`）：`platform_managed=True` 时 `changes_root`/`runtime_dir`/`db_path`/`docs_dir(p)`/`scan_dir(p)`/`modules_dir(p)` 均不含 `.sillyspec` 段（直接 `root/...`）；`platform_managed=False`（默认）保持 `.sillyspec` 包裹。`for_spec_workspace(spec_ws)` 工厂按 `strategy` 选 mode（platform-managed→True、repo-native/server-local→False）。
2. **各 reader 双模式单测**：scan_docs parser/service（`backend/app/modules/scan_docs/tests/`）、runtime/service（`runtime/tests/`）、spec_workspace/validator（`spec_workspace/tests/`）、knowledge/service+parser（`knowledge/tests/`）——每个 reader 至少两用例：platform-managed（扁平 `docs/`/`.runtime/`/`projects/` 直接在 spec_root）+ server-local（`.sillyspec/` 包裹）。构造 fake spec 树（tmp_path）断言解析结果。
3. **server-local/repo-native 回归测**（SC3）：既有 scan_docs/runtime/knowledge/validator 集成测全量跑通，确认 `platform_managed` 默认 False 零回归。

### Phase 2 测（sync 时机 + .runtime，FR-05~FR-07，D-002/D-003@v1，NFR-02）
4. **daemon scan 终态触发 sync 单测**（`sillyhub-daemon/src/__tests__/`）：mock daemon client，构造 scan interactive run 到 `completed`/`failed` 终态回调，断言 `syncSpecTreeIfNeeded(specSyncCtx, client)` 被调用一次；non-scan interactive（quick-chat，无 specSyncCtx）不触发。session-end 仍触发（兜底）。
5. **apply_sync 接收 .runtime + last_synced_at 集成测**（`spec_workspace/tests/`）：构造含 `.runtime/sillyspec.db` 的 daemon tar → `apply_sync` 后 `spec_root/.runtime/` 来自 tar（backend 旧 .runtime 被整树覆盖）；`spec_workspaces.last_synced_at` 非 NULL、`sync_status='clean'`。
6. **double-sync 幂等测**（NFR-02）：连续两次 `apply_sync`（模拟 scan 终态 + 后续 session-end）终态一致、无副作用、无残留 staging 临时目录。
7. **packSpecDir 含 .runtime 测**（`sillyhub-daemon/src/__tests__/`）：断言 push 路径打包结果含 `.runtime/`；pull 路径 `build_bundle`（backend 侧集成测）仍排除 `.runtime`（非对称契约 D-003）。

### Phase 3 测（daemon 代写 change，FR-08~FR-10，D-004@v1，NFR-03/04）
8. **proxy_create_change 集成测**（`change_writer/tests/`）：runtime online + 绑定 workspace → 校验通过 → 建 change-write pending 任务 → daemon 回执 ok → 落 `Change`+`ChangeDocument` 行 + 返回 change。
9. **daemon change-write handler 单测**（`sillyhub-daemon/src/__tests__/`）：mock pending-change-writes 返回 → claim（token）→ 本地写 `~/.sillyhub/daemon/specs/<wsId>/changes/<key>/` 文件 → 回执 `{ok, files[]}` → 触发 `syncSpecTreeIfNeeded`；断言**不启 agent**（agent 模块未被调用）。
10. **path traversal 拒绝测**（NFR-04）：change-write files 含 `../escape.md` / 绝对路径 → handler 拒绝写入 spec_root 之外。
11. **DAEMON_CLIENT_NO_SESSION 错误测**（FR-09）：daemon-client workspace 无 runtime_id / daemon 离线 → `proxy_create_change` 抛 `DaemonClientNoActiveSession`（code `DAEMON_CLIENT_NO_SESSION`, http 400）。
12. **pending 超时→failed 测**（NFR-03）：claimed 行 `claimed_at < now-60s` → gc 置 `failed, error='claim timeout'`；前端可重试（重新下发 pending）。

## acceptance

- 三 Phase 单测/集成测全过（backend `uv run pytest` + daemon `pnpm test`）。
- 覆盖矩阵达标：FR-01（reader mode）/FR-02（repo-native 回归）/FR-03（knowledge 重定向）/FR-04（prompt 一致化，若 task-05 有逻辑则补测，纯文案可轻测）/FR-05（scan 终态触发）/FR-06（.runtime 双端）/FR-07（last_synced_at）/FR-08（change-write 端到端）/FR-09（无 session 错误）/FR-10（不启 agent）。
- NFR-02（double-sync 幂等）/ NFR-03（超时→failed）/ NFR-04（traversal 拒绝）三非功能项各有对应测。

## verify

```
cd backend && uv run pytest
cd backend && uv run ruff check .
cd sillyhub-daemon && pnpm test
```

## constraints

- 严格遵守 CLAUDE.md 规则 8：被测逻辑本身有 bug 修逻辑，**禁止改测试绕过**；本任务只补测试，若发现实现缺陷回写对应 task（task-02~12）修代码。
- SQLite in-memory 测试注意 PG 方言分支（`FOR UPDATE SKIP LOCKED`/`date_trunc` 等），PG 走原生、SQLite 退化；测试断言**不绑死 SQL 函数名**（按行数/状态/时间戳断言，参考 MEMORY backend-test-sqlite-vs-pg）。
- daemon 测试用 `homedir()` mock，路径断言用 `path.join`/`path.resolve`，不拼平台分隔符（Windows/macOS/Linux 兼容，SC7）。
- change-write files 内容回执/落库断言用相对路径（`changes/<key>/MASTER.md`），不绑盘符。
- 不改 allowed_paths 之外的文件；测试 fixture 放各模块 `tests/` 或 `backend/tests/`。

## 执行记录（2026-06-26）

- 提交：`445881aa test(spec-sync): cover daemon-client spec sync contracts (task-13)`。
- 覆盖：补 scan_docs/runtime/knowledge/spec_workspace 双模式 reader 测试、`.runtime` apply_sync / double-sync 断言、daemon change-write handler 与 proxy-create 相关测试（task-09~12 提交内已包含对应模块测试）。
- 验证：
  - `uv run pytest app/modules/daemon/tests/test_change_write_router.py app/modules/change_writer/tests/test_proxy.py app/modules/knowledge/tests/test_router.py app/modules/runtime/tests/test_router.py app/modules/scan_docs/tests/test_service.py app/modules/spec_workspace/tests/test_bundle_sync.py app/modules/spec_workspace/tests/test_validator.py -q`：`75 passed`（新增 stale heartbeat 直接 API 回归）。
  - `pnpm vitest run tests/task-11-change-write.test.ts tests/spec-sync.test.ts`：`26 passed`。
  - `pnpm vitest run "src/app/(dashboard)/workspaces/[id]/create-change/__tests__/page.test.tsx"`：`4 passed`。
  - backend `ruff check` / `ruff format --check` / `mypy app` 通过；daemon `tsc --noEmit` 通过；frontend `typecheck` 通过，`lint` 仅既有 warning。
- 遗留：task-14 真实 e2e 未执行；需要 Docker backend rebuild + 宿主 daemon 环境。
