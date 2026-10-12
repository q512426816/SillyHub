---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 需求规格（Requirements）— 2026-10-12-ci-guard-diagnosability

## 功能需求

### FR-01: build-and-save.sh 零条 head 不再静默退出：grep -c 的非零退出被容忍（|| true），计数 0 走既有 [-ne 1] 分支打印 alembic heads 全文与解法引导后退出 1；多头路径行为逐字不变

- `ALEMBIC_HEAD_COUNT` 赋值必须在 `set -e` 下容忍 grep -c 的「0 计数即退出码 1」：零条 head（versions 目录被清空等异常形态）必须进入既有错误分支——打印 ❌ 引导、alembic heads 全文与 merge 解法提示后以非零退出，禁止在打印引导前静默退出；≥2 条多头路径与单头路径行为逐字不变。

#### 场景：零头给引导

- Given alembic heads 输出不含 '(head)' 行
- When 执行计数构造（set -euo pipefail 下）
- Then 计数变量为 0 且构造不中断脚本，错误分支可达

### FR-02: test_migration_single_head.py 对 CWD 不敏感：Config 显式 set_main_option script_location 为 backend_root/migrations 绝对路径，从仓库根与从 backend/ 两处跑均绿且多头时给出设计的中文提示（bash -n 校验脚本语法）

- 测试必须显式覆盖 `script_location` 为基于 `Path(__file__)` 的绝对路径；从仓库根与从 backend/ 两个 CWD 运行该测试文件均通过；多头断言文案（merge 解法中文提示）保持逐字不变。

#### 场景：双 CWD 均绿

- When 分别以仓库根、backend/ 为 CWD 运行该测试
- Then 均 passed（修复前从仓库根跑 CommandError: Path doesn't exist）

### FR-03: 仅跑本改动相关测试（规则 0）：pytest 该测试文件（backend/ 与仓库根两处 CWD 各跑一次）+ bash -n 脚本语法校验 + grep 计数模拟

- 本变更只必须运行上述验证，禁止跑全量测试套件（规则 0，全量留给 CI）。

#### 场景：相关面验证

- When 执行三项验证
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: deploy/scripts/build-and-save.sh（bash -n 语法 + grep 计数模拟：`set -euo pipefail` 下 `OUT="$(printf 'x' | grep -c '(head)' || true)"` 必须产出 0 不中断——模拟片段与结果留痕 tasks 勾选证据）
FR-02: backend/tests/test_migration_single_head.py「test_alembic_single_head」（仓库根与 backend/ 双 CWD 运行）
FR-03: backend/tests/test_migration_single_head.py（同上双 CWD + bash -n）
