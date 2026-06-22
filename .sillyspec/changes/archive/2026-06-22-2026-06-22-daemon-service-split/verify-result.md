---
author: qinyi
created_at: 2026-06-22T15:35:00+08:00
stage: verify
verdict: PASS
---

# 验证报告：daemon-service-split

> 变更：`2026-06-22-daemon-service-split`
> 验证阶段：verify（7/7 步）
> 角色：QA 专家（吹毛求疵，证据说话）
> 结论：**PASS** —— 实现符合 design.md，本变更范围（daemon 模块）全绿，行为零回归。

---

## 1. 总体结论

| 维度 | 结果 |
|------|------|
| 对照 design.md 一致性 | ✅ 一致（5 子域归位 / facade 兼容 / router 零改动 / 行为不变 / 异常 re-export / 生命周期契约不变）|
| task-01~08 AC 验收 | ✅ 全部满足（2 个行数偏离已决策接受）|
| 本变更范围测试（daemon+agent）| ✅ 625 passed, 0 failed（merge 后）|
| 全量 backend-test | 1820 passed, 7 skip, **2 failed（ppm，pre-existing 非本变更）** |
| lint（ruff + format + mypy）| ✅ 全绿（477 文件 format / 358 文件 mypy）|
| 铁律证据 | ✅ router.py 零改动（D-002）/ lease_service.py 零改动（D-003）|

**判定**：daemon-service-split 变更本身 **PASS**。唯一 2 个 test failure 在 ppm 模块，由主仓库 `344132e4 chore(ppm)` commit 引入，与 daemon-service-split 无因果关系（本变更 allowed_paths 从不含 ppm）。

---

## 2. 探针结果（Step 4）

| 探针 | 结果 | 说明 |
|------|------|------|
| 1 未实现标记扫描 | ✅ clean | daemon 模块无 TODO/FIXME/XXX/NotImplementedError/pass-only stub |
| 2 设计关键词覆盖 | ✅ 全覆盖 | 14 关键方法（register_runtime/heartbeat/create_lease/.../apply_patch_to_worktree）全在对应子包实现，0 缺失 |
| 3 测试覆盖 | ✅ | 18 个 daemon 测试文件（test_session_recovery/test_lease_service/test_run_input_service 等）|
| 4 决策追踪 | ✅ 闭环 | D-001~004 全闭环（design+requirements+decisions）；D-005 design §7.2 引用；**D-006 design 未引用 ⚠️**（见 §5 偏差）|
| 5 API parity | ✅ N/A | 本变更 router 零改动、API 不变；无 contract-artifacts，parity 保持 execute 前状态 |

---

## 3. Task AC 验收（Step 5）

| Task | AC 数 | 状态 | 关键证据 |
|------|------|------|---------|
| task-01 facade 安全网 | 12 | ✅ | 5 子包空壳 + facade __init__ 持引用（D-005 lazy import）|
| task-02 runtime 迁移 | 11 | ✅ | RuntimeService 10 方法 + _get_owned_runtime 委托保留（router:622 调用）|
| task-03 patch 迁移 | 12 | ✅ | PatchService + facade 保留私有名（3 调用点）|
| task-04 run_sync 迁移 | 12 | ✅ | RunSyncService 6 方法 + _facade 注入 + 跨域调用 |
| task-05 session 迁移 | 12 | ✅ | SessionService 20 方法 + recover_*/confirm/mark 迁（AC-2 session 1547 偏离接受）|
| task-06 lease 迁移 | 12 | ✅ | LeaseService + context.py + lease_service.py 零改动（D-003）|
| task-07 异常 re-export | 8 | ✅ | 异常类迁子包 + facade re-export 31 符号 + 子包直引（B6）|
| task-08 文档+验收 | 10 | ✅ | daemon.md facade 文档 + 全量验收（AC-8 session 1547 偏离接受）|

---

## 3.5 决策追踪闭环（D-001~006@v1）

| 决策 | 状态 | 实现证据（回指） |
|------|------|----------------|
| D-001@v1 方向 A 就地拆子包 | accepted ✅ | 5 子包 runtime/lease/run_sync/session/patch 落地（task-01~06）|
| D-002@v1 facade 完全兼容 router 零改动 | accepted ✅ | router.py vs pre-split(46591be0) 零改动（exit 0）；facade 41 委托 |
| D-003@v1 DaemonLeaseService 原位保留 | accepted ✅ | lease_service.py vs pre-split 零改动；agent cancel_lease 活契约（26 passed）|
| D-004@v1 方案 A 5 子域标准粒度 | accepted ✅ | session 整体一个子包（1547 行，偏离接受），未细分 |
| D-005@v1 facade __init__ lazy import | accepted ✅ | facade service.py __init__ 内函数级 lazy import 5 子 service（design §7.2）|
| D-006@v1 跨域 self._facade 引用注入 | accepted ✅ | RunSyncService/LeaseService 持 self._facade（task-04/06），测试 patch 目标跟随 |

全部 D-xxx@v1 在 decisions.md 定义 + design.md/requirements.md/tasks 实现证据闭环。无 unresolved/blocking。

---

## 4. 测试 + 质量扫描（Step 6）

### 4.1 本变更范围（daemon + agent 模块，merge 后）
- `pytest tests/modules/daemon/ app/modules/daemon/tests/ tests/modules/agent/ app/modules/agent/tests/`：**625 passed, 6 skip, 0 failed**
- 重点套件：test_session_recovery（12 passed，FR-04 契约不变）/ test_lease_service（36 passed，complete_lease 调用链）/ TestPatchApply / TestSubmitMessagesDualPublish / agent kill/cancel（FR-03 活契约）

### 4.2 全量 backend-test（`pytest -q --cov=app --cov-fail-under=60`）
- **1820 passed, 7 skipped, 2 failed**，覆盖率 ≥60%
- 7 skip：6 个 `_post_scan_reparse` 未实现（既有）+ 1 个 SQLite FOR UPDATE 限制（既有）
- **2 failed = ppm test_export**（见 §5.2）

### 4.3 lint
- `ruff check .`：All checks passed!（477 文件）
- `ruff format --check .`：477 files already formatted
- `mypy app`：Success, no issues（358 文件）

---

## 5. 偏差与观察（不阻断 PASS）

### 5.1 ⚠️ D-006 design.md 未交叉引用（minor 文档缺口）
- D-006（跨域 facade 引用策略 `self._facade`）在 decisions.md 定义 + tasks（task-04~06）实现充分，但 design.md 未交叉引用。
- D-005 已在 design §7.2 补充，D-006 漏补。
- 影响：无（decisions.md 是决策权威源，design §7.2 已阐明原则）。建议归档前/后补 design 引用。

### 5.2 ❌ ppm test_export 2 failed（pre-existing，非本变更）
- 失败：`test_response_shape` / `test_export_to_response_one_shot`
- 原因：`Content-Disposition` 实现加了 RFC 5987 `filename*=UTF-8''demo.xlsx`（支持中文文件名），但 test_export 断言仍期望老格式 `attachment; filename="demo.xlsx"`。
- 引入者：`344132e4 chore(ppm): rename export xlsx to 项目计划_YYYYMMDD_HHmmss.xlsx`（ppm 自己的 commit，execute 期间主仓库并行推进）。
- **与 daemon-service-split 无因果**：本变更 allowed_paths 从不含 ppm（grep 确认空）；daemon 拆分是纯结构重构，不影响 ppm。
- 处置：verify 阶段禁止修复源码。报告此为 ppm 模块/344132e4 commit 的测试 debt，应由 ppm 侧或独立 quick 任务修复（更新 test_export 断言匹配 filename* 格式）。

### 5.3 ⚠️ session/service.py 1547 行（已决策接受）
- AC-2/AC-8 目标 ≤1500，实际 1547（超 3%）。
- 原因：蓝图 ~1380 估算仅含方法体，遗漏 task-05 一并迁入的 9 异常/结果类 docstring。
- 已记录 design §5.2（更新行数 + 说明），止血目标（facade 3324→536）充分达成。
- 强行压缩需删 docstring（违反"异常类定义不变"）或拆子文件（违反 D-004 N1），得不偿失。

### 5.4 ℹ️ apply 变通（worktree commit + merge）
- sillyspec worktree apply 因主仓库 execute 期间被 commit 推进（baseline cb8c65ad→c6b9b85e 不匹配）失败。
- 变通：worktree commit（1a64f0ea）+ 主仓库 `git merge --no-ff`（67344cfa，解决 4 冲突：daemon 文档取 theirs、frontend.md 取 ours）。
- merge 后全绿（625 passed + lint），worktree 已 cleanup。改动完整保留在 main。

---

## 6. 结论

daemon-service-split 变更 **PASS** verify：
- 实现与 design.md 一致，8 个 task 的 AC 全部满足（2 行数偏离已接受）。
- 本变更范围（daemon 模块）625 passed 0 failed，router.py / lease_service.py 零改动铁证（D-002/D-003）。
- 行为零回归（全量 backend-test 本变更相关用例全绿；ppm 2 failed 经查为其他 commit 的 pre-existing debt，不在本变更范围）。
- lint 全绿。

**建议下一步**：归档（sillyspec-archive）+ 提交推送。ppm test_export 的 2 个失败建议另起 quick 任务修复（非本变更阻塞项）。
