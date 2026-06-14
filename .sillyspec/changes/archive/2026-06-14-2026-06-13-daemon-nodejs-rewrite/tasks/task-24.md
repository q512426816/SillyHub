---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-24
title: 删除 Python 源码（sillyhub_daemon/** + pyproject.toml）
priority: P0
estimated_hours: 1
depends_on: [task-23]
blocks: []
allowed_paths:
  - sillyhub-daemon/sillyhub_daemon/
  - sillyhub-daemon/pyproject.toml
  - sillyhub-daemon/tests/*.py
  - sillyhub-daemon/uv.lock
---

# task-24：删除 Python 源码（sillyhub_daemon/** + pyproject.toml）

> 变更：`2026-06-13-daemon-nodejs-rewrite`，Wave W5（CLI + 冒烟 + 收尾）的**最后一环**，T-W5-04。
> 性质：纯删除任务（无新代码、无新接口）。这是整个 Python→Node 重写的「语言栈切换落锤」动作。
> 时机铁律：**G 可回退的最后一刻才删**——必须在 task-23（T-W5-03 真实 backend 冒烟）全流程绿之后执行，否则禁止动手（design.md §10 R-07 应对策略）。
> 项目背景：本项目未正式上线（CLAUDE.md 铁律 7），数据可清空，无需做版本迁移/双写/灰度，删除即终态。

- Wave：W5（收尾）
- 依赖：task-23（真实 backend 冒烟通过——一次完整 lease：`task_available → claim → start → messages → complete + patch`，证据落 SMOKE.md）
- 阻塞：无（本任务是变更的最后一步，blocks 为空）
- Python 源对照（删除范围的事实依据，已用 `ls` 实测确认）：
  - `sillyhub-daemon/sillyhub_daemon/`（13 项：`__init__.py` / `__main__.py` / `agent_detector.py` / `backends/` 子目录 / `client.py` / `config.py` / `credential.py` / `daemon.py` / `protocol.py` / `task_runner.py` / `version.py` / `workspace.py`）
  - `sillyhub-daemon/sillyhub_daemon/backends/`（6 项：`__init__.py` / `json_rpc.py` / `jsonl.py` / `ndjson.py` / `stream_json.py` / `text.py`）
  - `sillyhub-daemon/pyproject.toml`（`[project] name=sillyhub-daemon`、`requires-python>=3.12`、`[project.scripts] sillyhub-daemon=sillyhub_daemon.__main__:cli`、hatchling build-backend）
  - `sillyhub-daemon/tests/*.py`（17 个 `test_*.py` + `__init__.py`，共 18 个 Python 文件——**与 vitest 的 `*.test.ts` 共存于同一 `tests/` 目录**，只删 `.py`，保留 `.test.ts`）
  - 已确认**不存在**：`sillyhub-daemon/uv.lock`、根 `uv.lock`、`__pycache__/`、`.pytest_cache/`、`*.pyc`（实测 `find` 无命中，但仍纳入清理清单作幂等兜底）

---

## 修改文件（删除清单）

| 操作 | 路径 | 说明 | 误删风险 |
|---|---|---|---|
| 删除（目录） | `sillyhub-daemon/sillyhub_daemon/` | Python 源码全部（含 `backends/` 子目录，共 18 个 `.py` 文件）。task-01~20 的 Node 实现已逐模块 1:1 替代 | 低——目录名 `sillyhub_daemon`（下划线）与 Node 源 `src/` 完全隔离 |
| 删除（文件） | `sillyhub-daemon/pyproject.toml` | Python 构建配置 + `[project.scripts]` 入口点 | 低——Node 入口已在 task-01 `package.json` 的 `bin`/`scripts` 定义 |
| 删除（glob） | `sillyhub-daemon/tests/*.py` | Python pytest 文件（18 个 `test_*.py` + `tests/__init__.py`）。**严格 `*.py`**，不得用 `tests/` 整目录删除 | **高**——`tests/` 下同时存在 task-22 迁移的 `*.test.ts`（vitest），误删整目录会摧毁 Node 测试 |
| 删除（若有） | `sillyhub-daemon/uv.lock` | uv 锁文件。**实测当前不存在**，列入清单仅为幂等（若 W0~W5 期间意外生成则一并清） | 低 |
| 清理（glob） | `sillyhub-daemon/**/__pycache__/`、`**/.pytest_cache/`、`**/*.pyc` | Python 运行/测试缓存。**实测当前无残留**，列为幂等兜底 | 低 |

> 关键：**所有删除路径都限定在 `sillyhub-daemon/` 目录内**，绝不触碰 `backend/`（Python，design.md N-04 明确不重写）、`frontend/`、`multi-agent-platform/`。

---

## 实现要求

### R1. 前置门槛检查（硬门槛，不满足禁止动手）

执行删除前，必须**逐项确认**下列证据，任一缺失即中止本任务（保持 Python 源码原样，回退到 task-23 重新冒烟）：

| 门槛 | 证据 | 来源 |
|---|---|---|
| G1 | task-23 真实 backend 冒烟已通过 | task-23 蓝图 AC（SMOKE.md 记录一次完整 lease 全绿） |
| G2 | Node 版 `npm run build`（`tsc --noEmit` 或等价）无错误 | task-01 工程 + task-11~20 全部源码编译通过 |
| G3 | Node 版 `npm test`（vitest）全绿 | task-22 测试迁移完成（17 个 Python 测试 1:1 迁移为 `*.test.ts`） |
| G4 | Python 版与 Node 版在同一 backend 上均跑通过至少一次 lease（功能等价证据） | task-23 冒烟对照（design.md G-01 功能等价） |

> design.md §9 兼容策略：Python 版在 W0–W4 全程保留并可运行；**仅在 W5 真实冒烟通过后才删除**。本任务的 R1 就是这把锁。

### R2. 精确删除清单（执行顺序：源码 → 配置 → 测试 → 缓存）

按下列顺序执行，每步删除后立即 `git status` 核对：

```
# 步骤 1：删除 Python 源码目录（含 backends/ 子目录，整体）
rm -rf sillyhub-daemon/sillyhub_daemon/

# 步骤 2：删除 Python 构建配置
rm -f sillyhub-daemon/pyproject.toml

# 步骤 3：删除 Python 测试（严格 *.py，保留 *.test.ts）
#   先列出待删清单人工核对，再删
find sillyhub-daemon/tests -maxdepth 1 -name "*.py" -print
#   核对输出仅含 test_*.py 和 __init__.py 后执行
find sillyhub-daemon/tests -maxdepth 1 -name "*.py" -delete

# 步骤 4：删除锁文件（若有，实测当前不存在）
rm -f sillyhub-daemon/uv.lock

# 步骤 5：清理 Python 缓存（幂等，实测当前无残留）
find sillyhub-daemon -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null
find sillyhub-daemon -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null
find sillyhub-daemon -name "*.pyc" -delete 2>/dev/null
```

> 铁律：步骤 3 **禁止** `rm -rf sillyhub-daemon/tests/`（会误删 `*.test.ts`）。必须用 `find ... -name "*.py"` 精确匹配。

### R3. CI / local.yaml / Docker 引用切换检查

删除 Python 源码后，扫描全仓对 Python daemon 的引用并切换到 Node 命令（与 task-25 Docker/构建切换协调，但 task-24 先处理非 Docker 的引用）：

| 引用点 | 实测状态 | 处理 |
|---|---|---|
| `.github/workflows/backend-ci.yml`（`uv run ruff/mypy/pytest`） | **实测：仅针对 `backend/`**（`--cov=app`），与 daemon Python 无关 | **不动** |
| `.sillyspec/.runtime/local.yaml` | **实测：无 daemon/python 引用** | 无需切换 |
| `deploy/docker-compose*.yml` | **实测：无 daemon 引用**（sillyhub-daemon 是本地工具，不进 compose） | 无需切换（task-25 确认） |
| `sillyhub-daemon/Dockerfile` | **实测：不存在** | 无需处理 |
| `README.md:130`（`└── sillyhub_daemon/`） | **实测：有引用**（项目结构图） | 切换为 `src/`（Node 目录结构），与 task-21 CLI 文档协调 |
| 全仓 `grep -rn sillyhub_daemon` | 实测命中：本变更文档 + 历史变更文档 + README + `docs/sillyhub-daemon/` 扫描文档 | 历史变更文档（`.sillyspec/changes/2026-06-09-*`）**不动**（历史快照）；`docs/` 扫描文档由 sillyspec-scan 在归档时刷新 |

> 引用切换的判定原则：**只改「活文档」**（README、当前 local.yaml、当前 CI），**不改「历史快照」**（已归档/在途变更的 design.md/tasks.md，它们是时间点的真实记录）。

### R4. 回归验证（删除后 Node 版仍可 build + test）

删除完成后，在 `sillyhub-daemon/` 目录执行回归，确认 Node 工程自洽：

```
cd sillyhub-daemon
npm run build    # tsc 编译，必须 0 error
npm test         # vitest，必须全绿（与删除前基线一致）
npm run dev -- --help  # 或 npx tsx src/cli.ts --help，确认 CLI 可启动（task-21）
```

任一失败 → 立即 `git checkout -- sillyhub-daemon/` 回滚删除，定位是否删除路径越界或 Node 版本身有隐性依赖 Python 源（理论上不可能，因 Node 版零 Python 依赖，design.md G-05）。

### R5. git 状态验证

删除后 `git status` 应呈现：

- 删除：`sillyhub-daemon/sillyhub_daemon/**`（18 个 `.py`）
- 删除：`sillyhub-daemon/pyproject.toml`
- 删除：`sillyhub-daemon/tests/*.py`（18 个）
- **未动**：`sillyhub-daemon/package.json` / `tsconfig.json` / `vitest.config.ts` / `src/**` / `tests/*.test.ts` / `dist/`（如有）
- 修改（若 R3 处理）：`README.md`

`sillyhub-daemon/` 目录树应只剩 Node 工程结构：

```
sillyhub-daemon/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/            # Node 源码（task-01~21 产物）
├── tests/          # 仅 *.test.ts（task-22 产物）
└── dist/           # 编译产物（若有，task-01 build 产出）
```

---

## 接口定义

本任务**无源码接口**（纯删除，无新增/修改导出）。给出三张检查表替代接口契约：

### 删除清单表（精确到文件/目录）

| # | 路径 | 类型 | 删除方式 | 文件数（实测） |
|---|---|---|---|---|
| D1 | `sillyhub-daemon/sillyhub_daemon/` | 目录 | `rm -rf` | 12 顶层 `.py` + `backends/` 6 `.py` = 18 |
| D2 | `sillyhub-daemon/pyproject.toml` | 文件 | `rm -f` | 1 |
| D3 | `sillyhub-daemon/tests/*.py` | glob | `find -name "*.py" -delete` | 17 `test_*.py` + 1 `__init__.py` = 18 |
| D4 | `sillyhub-daemon/uv.lock` | 文件（若有） | `rm -f` | 0（实测不存在） |
| D5 | `**/__pycache__/` `**/.pytest_cache/` `**/*.pyc` | glob | `find -delete` | 0（实测无残留） |

### 删除前后目录对比

**删除前**（当前状态，实测）：
```
sillyhub-daemon/
├── package.json          # Node（task-01）
├── tsconfig.json         # Node（task-01）
├── vitest.config.ts      # Node（task-01）
├── pyproject.toml        # Python（删）
├── sillyhub_daemon/      # Python 源（删）
│   ├── __init__.py
│   ├── __main__.py
│   ├── agent_detector.py
│   ├── client.py
│   ├── config.py
│   ├── credential.py
│   ├── daemon.py
│   ├── protocol.py
│   ├── task_runner.py
│   ├── version.py
│   ├── workspace.py
│   └── backends/
│       ├── __init__.py
│       ├── json_rpc.py
│       ├── jsonl.py
│       ├── ndjson.py
│       ├── stream_json.py
│       └── text.py
├── src/                  # Node 源（保留）
├── tests/                # 混合
│   ├── __init__.py       # Python（删）
│   ├── test_*.py         # Python ×17（删）
│   └── *.test.ts         # vitest（保留，task-22 产物）
└── dist/                 # 编译产物（保留，若有）
```

**删除后**（目标状态）：
```
sillyhub-daemon/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
├── tests/                # 仅 *.test.ts
└── dist/                 # 若有
```

### 引用切换检查点

| 检查命令 | 期望结果（删除+切换后） |
|---|---|
| `grep -rn "sillyhub_daemon" sillyhub-daemon/` | 无命中（Python 模块名彻底消失） |
| `grep -rn "pyproject\|requires-python\|hatchling" sillyhub-daemon/` | 无命中 |
| `grep -rn "import.*backends\|from backends" sillyhub-daemon/src/` | 无命中（Node 用 `./adapters/`） |
| `find sillyhub-daemon -name "*.py"` | 无命中 |
| `find sillyhub-daemon -name "pyproject.toml"` | 无命中 |
| `grep -n "sillyhub_daemon" README.md` | 无命中（已切换为 `src/`） |
| `grep -rn "sillyhub_daemon" .github/ deploy/` | 无命中（本就无 daemon 引用，保持） |

---

## 边界处理

| # | 场景 | 处理 |
|---|---|---|
| B1 | **task-23 冒烟未通过**（lease 流程任一环节失败） | **禁止执行本任务**。Python 源码原样保留，回到 task-23 排查。design.md §9 回退路径：Python 版在冒烟通过前始终可运行 |
| B2 | **误删 vitest `tests/*.test.ts`**（步骤 3 用错命令，如 `rm -rf tests/`） | 预防：步骤 3 强制用 `find -maxdepth 1 -name "*.py"`，先 `-print` 人工核对再 `-delete`。恢复：若误删，`git checkout -- sillyhub-daemon/tests/` 恢复（task-22 产物已 git 跟踪）。**严禁** 在未恢复的情况下继续 |
| B3 | **CI 配置（`.github/workflows/`）仍引用 Python daemon 命令** | 实测：`backend-ci.yml` 的 `uv run` 仅针对 `backend/app`，与 daemon 无关。若发现新增 CI 引用 daemon（如 `sillyhub-daemon` 专属 workflow），切换为 `npm run build && npm test`。本任务范围内未发现此类 CI |
| B4 | **`local.yaml` daemon 命令未切换** | 实测：`.sillyspec/.runtime/local.yaml` 无 daemon 引用。若 task-21/23 期间新增了对 Python `sillyhub-daemon` 命令的引用，切换为 Node `npx tsx src/cli.ts` 或 `npm run dev` |
| B5 | **`__pycache__` / `.pytest_cache` / `*.pyc` 残留** | 实测当前无残留（开发者可能本地跑过 pytest 则会生成）。步骤 5 幂等清理，`find -delete` 无命中也不报错 |
| B6 | **git 历史保留 vs 工作区删除** | 本任务只删**工作区文件**，git 历史（提交记录）保留 Python 源码的全部历史。这是设计意图——回退时 `git log` / `git checkout <旧commit> -- sillyhub-daemon/sillyhub_daemon/` 可恢复。**不清理 git 历史**（非目标 NG-3） |
| B7 | **回滚方案** | 删除后若 Node 回归（R4）失败：`git checkout -- sillyhub-daemon/` 恢复全部删除，或 `git revert`（若已提交）。Python 源码在 git 历史中永不在物理上丢失 |

---

## 非目标

| # | 非目标 | 理由 |
|---|---|---|
| NG-1 | 不删 `backend/` 的 Python 源码 | backend 是独立子项目，design.md N-04 明确不在本变更范围。`backend/app/modules/daemon/protocol.py` 是 Node daemon 的对端契约，**必须保留** |
| NG-2 | 不删 `.sillyspec/` 下的 design.md / plan.md / tasks.md / 历史 task 蓝图 | 这些是变更的规范文档与历史快照，归档时整体移入 `archive/`（sillyspec-archive 流程），不在本任务范围 |
| NG-3 | 不清理 git 历史（不 rewrite 历史、不 GC） | 本任务只动工作区。git 历史保留 Python 源码全量记录是回退能力的基石 |
| NG-4 | 不做数据迁移 / 配置文件迁移 | 本项目未上线（CLAUDE.md 铁律 7），`~/.sillyhub/daemon/config.json` / `credentials.json` 格式 Node 版完全沿用（design.md §8、§9 不变项），无需迁移 |
| NG-5 | 不重写 `docs/sillyhub-daemon/` 扫描文档 | 扫描文档（STRUCTURE.md / modules/cli.md 等）由 sillyspec-scan 在变更归档时统一刷新，不在本任务手动改 |

---

## 参考

| 来源 | 章节 | 关键内容 |
|---|---|---|
| `design.md` §6 文件变更清单 | 「删除」行 | `sillyhub-daemon/sillyhub_daemon/**`（Python 源码，W5 冒烟通过后删除）、`sillyhub-daemon/pyproject.toml`（Python 构建配置，W5 后删除） |
| `design.md` §9 兼容策略 | 回退路径 | 「Python 版 `sillyhub_daemon/` 在 W0–W4 全程保留并可运行；**仅在 W5 真实冒烟通过后才删除**」 |
| `design.md` §10 R-07 | 风险与应对 | 「重写期间 Python 版与 Node 版并存导致 Docker 构建/入口混乱」→「W5 前 Python 版不进新镜像；W5 切换入口并删除 Python 源码，单点切换」 |
| `tasks.md` T-W5-04 | 任务定义 | 「删除 Python 源码 — `sillyhub-daemon/sillyhub_daemon/**`、`sillyhub-daemon/pyproject.toml`（冒烟通过后）」 |
| `tasks.md` T-W5-03 | 依赖前置 | task-23 真实 backend 冒烟（本任务的 depends_on） |
| task-23 蓝图 | AC | 冒烟结果证据（SMOKE.md） |
| `.sillyspec/.runtime/local.yaml` | 引用检查 | 实测无 daemon/python 引用 |
| `CLAUDE.md` 铁律 7 | 未上线免责 | 「本项目未正式上线，不需要考虑版本迭代兼容问题，数据可以清空」 |

---

## TDD 步骤

本任务是删除任务，TDD 体现为「快照 → 删除 → 回归断言」三段式（非传统的 红-绿-重构）：

### 步骤 1：删除前快照（基线）

```bash
# 记录删除前的关键基线
cd sillyhub-daemon
npm run build 2>&1 | tail -5    # 记录编译输出
npm test 2>&1 | tail -10        # 记录测试通过数（基线 N 个用例）
git status --short              # 记录删除前工作区状态
find . -name "*.py" | wc -l     # 记录 Python 文件数（应为 36：源 18 + 测试 18）
```

### 步骤 2：执行删除（R2 五步）

按 R2 顺序执行 `rm -rf` / `rm -f` / `find -delete`，每步后 `git status --short` 核对。

### 步骤 3：回归断言（删除后必须全绿）

```bash
cd sillyhub-daemon
# 断言 1：编译仍通过（与基线一致）
npm run build
# 断言 2：测试仍全绿（用例数与基线一致——Python 测试删除不影响 vitest）
npm test
# 断言 3：无 Python 残留
test -z "$(find . -name '*.py')" && echo "OK: no .py" || echo "FAIL: .py残留"
test -z "$(find . -name 'pyproject.toml')" && echo "OK: no pyproject" || echo "FAIL"
test -z "$(grep -rn 'sillyhub_daemon' . --include='*.ts' --include='*.json' --include='*.yaml')" && echo "OK: no ref" || echo "FAIL: 残留引用"
# 断言 4：CLI 可启动（task-21 产物仍工作）
npx tsx src/cli.ts --help
```

### 步骤 4：对照验收标准逐项勾选（见下表）

---

## 验收标准

| AC | 项目 | 验证方法 | 通过条件 |
|---|---|---|---|
| AC-01 | 冒烟通过证据 | 查 task-23 的 SMOKE.md / 蓝图 AC | task-23 真实 backend 冒烟全流程绿（完整 lease：`task_available → claim → start → messages → complete + patch`） |
| AC-02 | `sillyhub_daemon/` 目录删除 | `test ! -d sillyhub-daemon/sillyhub_daemon/` | 目录不存在（含 `backends/` 子目录一并消失） |
| AC-03 | `pyproject.toml` 删除 | `test ! -f sillyhub-daemon/pyproject.toml` | 文件不存在 |
| AC-04 | Python `tests/*.py` 删除，vitest `*.test.ts` 保留 | `find sillyhub-daemon/tests -name "*.py"` 空 且 `find sillyhub-daemon/tests -name "*.test.ts"` 非空 | `.py` 为 0，`.test.ts` 数量与 task-22 产物一致 |
| AC-05 | 无 Python 残留引用 | `grep -rn "sillyhub_daemon\|pyproject\|requires-python\|hatchling" sillyhub-daemon/` | 无命中（README 若引用则在 R3 切换为 `src/`） |
| AC-06 | Node build + test 回归绿 | `cd sillyhub-daemon && npm run build && npm test` | 编译 0 error，测试全绿，用例数与删除前基线一致 |
| AC-07 | git 状态干净可提交 | `git status --short` | 仅显示删除（D）+ 可能的 README 修改（M），无未预期的改动；提交后 `git status` clean |
