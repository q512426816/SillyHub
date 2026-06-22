---
id: task-08
title: 更新 daemon.md 模块文档（契约摘要+变更记录）+ 全量验收（router diff为空/全测/lint/契约对比）
priority: P0
estimated_hours: 1
depends_on: [task-07]
blocks: []
requirement_ids: [FR-01, FR-04]
decision_ids: []
allowed_paths:
  - .sillyspec/docs/backend/modules/daemon.md
author: qinyi
created_at: 2026-06-22T10:21:00+08:00
---

# task-08: 更新 daemon.md 模块文档 + 全量验收

收尾任务。W2-W6 子域迁移 + task-07 异常类 re-export 完成后，本任务做两件事：(1) 把 `daemon.md` 模块文档的契约摘要与变更记录同步到本次拆分后的状态；(2) 按 `plan.md` 全局验收标准章节执行全量验收，逐条核对 9 条 AC。本任务**只改文档 + 跑验收命令**，不触碰任何源码。

## 修改文件

| # | 路径 | 操作 | 说明 |
|---|---|---|---|
| 1 | `.sillyspec/docs/backend/modules/daemon.md` | 修改 | (a) 契约摘要补充 facade 化说明：`DaemonService` 现为 facade，内部委托 `runtime/lease/run_sync/session/patch` 5 子域 service；(b) 变更记录追加 `2026-06-22-daemon-service-split` 条目 |

> 源码改动 = 0。任何 backend/app/modules/daemon/** 路径在本任务都不应出现 diff。

## 覆盖来源

- **FR-01**：`router.py` 零改动 —— 全量验收中以 `git diff backend/app/modules/daemon/router.py` 为空作为铁证。
- **FR-04**：runtime/lease/agent_run/session 四对象生命周期状态流转迁移前后对比一致 —— 全量验收中以 51 方法签名逐位对比 + 全测通过作为证据。

> FR/D 覆盖矩阵见 plan.md（FR-01 → task-01,task-08；FR-04 → task-04,task-05,task-08）。

## 实现要求

### R-01: daemon.md 契约摘要补充（facade 化）

在现有 `## 契约摘要` 章节的 `DaemonService` 条目下追加 facade 说明，使其反映拆分后状态。建议措辞（最终措辞以保持与 design.md §7.1 / proposal.md 一致为准）：

```markdown
- `DaemonService`（facade）：现为薄 facade，保留全部 51 个方法签名不变，内部委托 5 个子域 service。
  - `runtime/service.py` → `RuntimeService`：runtime 注册/心跳/启停/清理。
  - `lease/service.py` → `LeaseService`：lease 创建/认领/启动/续约/完成/过期（承接原 `DaemonService.lease_*`）。
  - `run_sync/service.py` → `RunSyncService`：AgentRun 状态同步 / 交互式 run 关闭 / 消息提交。
  - `session/service.py` → `SessionService`：AgentSession 创建/注入/中断/结束/恢复/重连/查询（最大子域）。
  - `patch/service.py` → `PatchService`：worktree diff 应用。
- `DaemonLeaseService`（`lease_service.py`）：独立活 service，`cancel_lease` 被 agent 模块跨模块调用，原位保留，与本次 `LeaseService` 分管 lease 不同操作。
- 异常类定义已迁入对应子包，facade `service.py` 集中 re-export，`from app.modules.daemon.service import XxxError` 路径不变。
```

### R-02: daemon.md 变更记录追加

在现有 `## 变更记录` 列表追加一行（格式遵循现有 `2026-06-19-runtimes-layout` 条目风格，变更名 + 一句话说明）：

```markdown
- 2026-06-22-daemon-service-split：将 `DaemonService` 巨石（~3000 行/51 方法）按生命周期拆为 `runtime/lease/run_sync/session/patch` 5 子域子包，`DaemonService` 退化为 facade（签名不变、router.py 零改动、行为不变）。
```

### R-03: 全量验收命令清单（对照 plan.md「全局验收标准」9 条）

> 全部命令在仓库根目录（`C:\Users\qinyi\IdeaProjects\multi-agent-platform`）执行。Windows 用 Git Bash。

| AC# | 验证点 | 命令 | 通过标准 |
|-----|-------|------|---------|
| AC-01 | router.py 零改动（D-002 铁证，FR-01） | `git diff backend/app/modules/daemon/router.py` | 输出为空（exit 0 且无 diff 行） |
| AC-02 | daemon 全测通过（含 session_recovery 16 用例） | `make backend-test` | exit 0；pytest 全绿；`--cov-fail-under=60` 达标 |
| AC-02a | session_recovery 用例确认（FR-04 契约不变铁证） | `cd backend && uv run pytest -q app/modules/daemon/tests/test_session_recovery.py` | 16 passed |
| AC-03 | lint 全过（ruff + format check + mypy） | `make backend-lint` | exit 0（ruff check 无错 / format check 无 diff / mypy 无错） |
| AC-04 | DaemonService 51 方法签名迁移前后逐位一致 | 见下方「契约对比方法」小节 | 51 方法名 + 参数签名 + 返回类型 + 抛出异常类型全部一致 |
| AC-05 | agent 模块跨模块 import 仍可用（D-003 兼容） | `cd backend && uv run python -c "from app.modules.daemon.lease_service import DaemonLeaseService; assert hasattr(DaemonLeaseService, 'cancel_lease')"` | exit 0，无 ImportError |
| AC-06 | router.py:55 的 9 异常类 + DaemonService re-export 兼容（FR-05/D-002） | `cd backend && uv run python -c "from app.modules.daemon.service import DaemonService, DaemonLeaseNotFound, DaemonRpcForbiddenError, DaemonRpcGatewayError, DaemonRpcRemoteError, DaemonRpcRemoteGatewayError, DaemonRpcTimeout, DaemonRuntimeNotFound, DaemonRuntimeOffline, DaemonSessionNotFound; print('ok')"` | 输出 `ok`，无 ImportError |
| AC-07 | runtime/lease/agent_run/session 四对象生命周期状态流转对比一致（FR-04） | 对照 design.md §7.5 契约表 + AC-04 签名对比 + AC-02 全测通过 | 三者交叉印证契约不变 |
| AC-08 | session/service.py ≤ 1500 行（D-004 标准粒度） | `wc -l backend/app/modules/daemon/session/service.py` | ≤ 1500 |
| AC-09 | facade 化确认（类体为委托，无业务逻辑） | `grep -n "class DaemonService" backend/app/modules/daemon/service.py` + 人工抽查方法体 | class 定义存在；方法体形如 `return await self._rt.xxx(...)` 委托形式，无 SQL/状态机业务逻辑 |

> AC-02 与 AC-02a：AC-02 已覆盖 AC-02a（全量跑含 session_recovery），AC-02a 列出仅作「FR-04 契约不变」的强证据锚点，可单独再跑一次以获得独立 16 passed 证据。

### R-04: 契约对比方法（AC-04 落地手段）

迁移前后方法签名对比采用如下方式（任选其一，二者等价）：

**方式 A：从 git 历史提取签名快照对比**

```bash
# 迁移前（W1 之前，即变更起点）的 DaemonService 方法签名
git show <pre-split-commit>:backend/app/modules/daemon/service.py \
  | grep -nE '^\s+(async\s+)?def ' > /tmp/before.txt

# 迁移后（当前工作区 / task-07 完成后）
grep -nE '^\s+(async\s+)?def ' backend/app/modules/daemon/service.py > /tmp/after.txt

# 对比（仅方法名+签名，去掉方法体）
diff /tmp/before.txt /tmp/after.txt
```

**方式 B：用 Python AST 提取签名**

```bash
cd backend && uv run python -c "
import ast, sys
def sigs(path):
    tree = ast.parse(open(path, encoding='utf-8').read())
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == 'DaemonService':
            for f in node.body:
                if isinstance(f, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    args = [a.arg for a in f.args.args]
                    out.append(f'{f.name}({\",\".join(args)})')
    return out
# before/after 路径自行替换（after = 当前工作区，before = git show 输出到临时文件）
print('\n'.join(sigs('app/modules/daemon/service.py')))
"
```

通过标准：`diff` 输出为空（方法名、参数列表、async 与否完全一致）。返回值/异常类型无法纯静态对比，结合 AC-02 全测通过 + AC-07 契约表对照确认。

## 接口定义

N/A —— 本任务为文档更新 + 验收执行任务，无新增/修改接口。

## 边界处理

1. **验收失败回退对应 Wave**：若 AC-01（router diff 非空）失败 → 回退到 task-01 检查 facade 兼容；若 AC-04（签名不一致）失败 → 回退到具体迁出 Wave（task-02~06）补齐遗漏方法；若 AC-06（re-export 失败）失败 → 回退 task-07 补全异常类 re-export。本任务**不修复源码**，只定位 + 上报，触发对应 Wave 的修复后再重跑验收。
2. **docs 变更记录格式遵循现有**：`daemon.md` 现有变更记录格式为 `<change-id>：<一句话说明>`（见 `2026-06-19-runtimes-layout` 条目），本任务追加条目严格沿用此格式，不引入新模板字段。
3. **验收命令统一走 Makefile**：AC-02/AC-03 必须用顶层 `make backend-test` / `make backend-lint`（实现见 `Makefile:51-55`：`cd backend && uv run pytest -q --cov=app --cov-fail-under=60` / `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app`），禁止绕过 Makefile 手敲等价命令，确保与 CI 一致。
4. **契约对比方法（R-04）**：优先用方式 A（git diff 签名快照），方式 B（AST）作为方式 A 在 diff 噪声大时的备选；返回值/异常类型不能纯静态对比，必须叠加 AC-02 全测 + AC-07 契约表人工对照三方印证。
5. **router diff 验证法**：`git diff backend/app/modules/daemon/router.py` 必须在**工作区干净、无未提交的 router 改动**前提下执行；若工作区有其他未提交改动污染，先 `git stash` 排除后再 diff。diff 为空 = exit 0 且输出零行。
6. **daemon.md 只在本任务改**：`allowed_paths` 仅 `.sillyspec/docs/backend/modules/daemon.md`；如验收过程中发现 design.md / plan.md / proposal.md 需同步修订（例如拆分后子域行数与预估偏差大），不在本任务改，另起文档同步小任务（sillyspec quick）。
7. **session/service.py 行数边界**：AC-08 阈值 ≤1500 行来自 design.md §5.2（预估 ~1380 行，留 ~120 行余量）。若实测超过 1500，触发 design §3 N1 重评估（session 子域是否需进一步细分），不在本任务内做，上报到 plan 层。
8. **lint 阻断**：本项目 pre-commit ci-check hook 在 commit/push 前会全量跑 backend mypy + frontend lint/typecheck/test（见 MEMORY.md `pre-commit-ci-check-hook.md`），纯文档提交也触发；本任务改 daemon.md 后若需提交，提交前必须 `make backend-lint` 本地先过，否则 hook 拦截。

## 非目标

- **不改任何源码**：`backend/app/modules/daemon/**` 在本任务零 diff；任何源码修复触发对应 Wave 重做。
- **不做性能测试**：本变更为纯结构重构，design.md §3 N4 明确「不动运行时行为」，不引入性能基准对比。
- **不改 design.md / plan.md / proposal.md**：这三份变更治理文档在本变更生命周期内冻结；如需同步实际拆分结果（如行数偏差），另起文档同步任务。
- **不改 router.py**：与 D-002 一致，router.py 在整个变更（含本任务）零改动。
- **不做 e2e / 集成测试新增**：验收复用现有 daemon 测试集（test_session_recovery 16 用例等），不新增测试。
- **不归档本变更**：归档（archive）是 sillyspec-archive 独立流程，本任务仅完成验收，归档由用户/后续流程触发。

## 参考

- `proposal.md`「成功标准（可验证）」10 条（FR-01 router diff 为空 / 全测通过 / mypy+ruff 全过 / grep facade 化 / 51 签名不变 / DaemonLeaseService 兼容 / 9 异常类 re-export / 生命周期状态流转对比一致 / session ≤1500 行）—— 本任务 AC-01~AC-09 逐条对应。
- `plan.md`「全局验收标准」9 条 —— 本任务 AC 表的来源。
- `design.md` §7.5「生命周期契约表」—— AC-07 契约对比的基准表。
- `design.md` §6「文件变更清单」—— daemon.md 条目（操作=文档）。
- `.sillyspec/docs/backend/modules/daemon.md`（现有模块文档，含 `2026-06-19-runtimes-layout` 变更记录格式范例）。
- `Makefile:51-55`（backend-test / backend-lint 实现）。
- `MEMORY.md` `pre-commit-ci-check-hook.md`（commit/push 前全量 lint 阻断行为）。

## TDD 步骤

N/A —— 本任务为文档更新 + 验收执行，无新增测试代码。验收以现有 daemon 测试集（test_session_recovery 等）+ 静态检查（ruff/mypy）+ diff/契约对比为「测试」。

## 验收标准

> 逐条对应 `plan.md`「全局验收标准」9 条 + proposal.md 成功标准 10 条。

| AC# | 验证步骤 | 通过标准 | 对应全局验收 |
|-----|---------|---------|-------------|
| AC-01 | `git diff backend/app/modules/daemon/router.py` | 输出为空 | 全局#1 / proposal-1（FR-01, D-002） |
| AC-02 | `make backend-test` | exit 0；含 test_session_recovery 16 用例 + test_lease_service + test_run_input_service 全绿；cov ≥ 60 | 全局#2 / proposal-2 |
| AC-02a | `cd backend && uv run pytest -q app/modules/daemon/tests/test_session_recovery.py` | 16 passed（FR-04 契约不变铁证） | 全局#2 子项 / proposal-8 |
| AC-03 | `make backend-lint` | exit 0；ruff check 无错 + format check 无 diff + mypy 无错 | 全局#3 / proposal-3 |
| AC-04 | DaemonService 51 方法签名迁移前后对比（R-04 方式 A 或 B） | diff 为空：方法名 + 参数列表 + async 全部一致 | 全局#4 / proposal-5 |
| AC-05 | `from app.modules.daemon.lease_service import DaemonLeaseService` + `hasattr(..., 'cancel_lease')` | import 成功 + cancel_lease 存在 | 全局#5 / proposal-6（D-003） |
| AC-06 | `from app.modules.daemon.service import` 9 异常类 + DaemonService | 全部 import 成功，无 ImportError | 全局#6 / proposal-7（FR-05, D-002） |
| AC-07 | design.md §7.5 契约表 × AC-04 签名对比 × AC-02 全测通过 三方交叉印证 | runtime/lease/agent_run/session 四对象状态流转迁移前后一致 | 全局#7 / proposal-8（FR-04） |
| AC-08 | `wc -l backend/app/modules/daemon/session/service.py` | ≤ 1500 | 全局#8 / proposal-9（D-004） |
| AC-09 | `grep -n "class DaemonService" service.py` + 抽查方法体 | class 存在；方法体为 `return await self._xx.yyy(...)` 委托形式，无业务逻辑 | 全局#9 / proposal-4（facade 化） |
| AC-10 | daemon.md 契约摘要含 facade 化说明 + 变更记录含 2026-06-22-daemon-service-split 条目 | grep 命中两条；格式遵循现有变更记录风格 | 本任务特有（文档同步） |
