---
id: task-01
title: 修复 alembic 链断裂（删除多余坏 merge revision 202606281200，核实 head=202606241001）
priority: P0
estimated_hours: 0.5
depends_on: []
blocks: [task-04]
requirement_ids: []
decision_ids: [D-005@v1]
allowed_paths:
  - backend/migrations/versions/
author: WhaleFall
created_at: 2026-06-25T08:43:50
---

# task-01 — 修复 alembic 链断裂

## 背景（已排查确认）

`backend/migrations/versions/202606281200_merge_multi_heads.py` 的 `down_revision = ("202606241000", "202606281000")`，但**不存在** revision id = `202606281000` 的文件 → `alembic heads` / `alembic current` 等任何 alembic 命令均抛 `KeyError`，导致 task-04（新增 email nullable migration）无法 `alembic upgrade head`，是整个 username-login 变更的前置阻塞。

真实链结构（已 grep 核实）：

```
… → 202607240900 → 202606241000 → 202606241001   (线性父子链)
                                          ↑
                       202606281200_merge_multi_heads（坏 merge，无子，引用不存在的 202606281000）
```

- `202606241000`（文件 `202606241000_add_session_rotated_at.py`）：`down_revision = "202607240900"`
- `202606241001`（文件 `202606280900_add_agent_cache_token_fields.py`，**文件名与 revision id 不一致，内部 revision = "202606241001"**）：`down_revision = "202606241000"`
- 坏 merge `202606281200`（文件 `202606281200_merge_multi_heads.py`）：`revision = "202606281200"`，`down_revision = ("202606241000", "202606281000")`，`upgrade()/downgrade()` 均为 `pass`（空合并）
- grep 确认 `202606281200` 无任何 revision 将其作为 `down_revision`（无子），删除安全
- grep 确认 `202606281000` 全局零引用（坏 merge 的第二 down 是唯一引用点，且本身不存在）

`202606241000` 与 `202606241001` 是线性父子而非分叉两支，故该 merge 无存在意义，删除即可恢复线性链，head 落在 `202606241001`。覆盖决策 **D-005@v1**（方案 A 最小兼容 + 删除多余 merge revision）。

## 修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/migrations/versions/202606281200_merge_multi_heads.py` | **删除** | 坏 merge revision，内容为空（upgrade/downgrade 均 pass），生产 DB 未应用过坏链 |

> 仅删除一个文件，不新建、不修改任何其他文件。`backend/migrations/versions/__init__.py`（空文件）不动。

## 覆盖来源

| 来源 | 位置 | 关键内容 |
|---|---|---|
| `design.md` §3 Phase 0 | `.sillyspec/changes/2026-06-24-username-login/design.md:35-39` | 删除 `202606281200_merge_multi_heads.py`，链恢复线性 `…→202606241000→202606241001`，head=`202606241001`；新 migration 的 `down_revision="202606241001"` |
| `design.md` §6 风险表 | `design.md:102` | 该 merge revision 内容为空（仅合并），生产 DB 未应用过坏链；删除安全；execute 前用 `alembic current` 核实 |
| `plan.md` Wave 1 | `plan.md:18` | task-01: 修复 alembic 链断裂（删除多余坏 merge `202606281200`，核实 head=`202606241001`）（覆盖 D-005@v1） |
| `plan.md` 任务总表 | `plan.md:41` | task-01 依赖 — ，阻塞 task-04 |
| `decisions.md` D-005@v1 | `.sillyspec/changes/2026-06-24-username-login/decisions.md` | 方案 A 最小兼容 + 删除多余 merge revision |

## 实现要求

1. **execute 前置核实（不可跳过）**：在 `backend/` 目录下执行 `alembic current`，记录生产 DB 当前版本号。
   - 预期：因坏 merge 引用不存在的 `202606281000`，`alembic current` 可能也报 `KeyError`（与 `alembic heads` 同因）。若报错，记录错误信息，**这正是要修复的症状**，继续后续删除步骤即可；若能正常输出，记录当前 revision。
2. **删除坏 merge 文件**：`rm backend/migrations/versions/202606281200_merge_multi_heads.py`。
3. **删除后验证 head**：在 `backend/` 下执行 `alembic heads`，应输出**单一** head = `202606241001`（202606281200 已不在版本图中）。
4. **验证 current**：再次 `alembic current`，应能正常输出（不再 KeyError）。生产 DB 实际版本号应保持删除前一致或为某线性祖先（`202607240900` / `202606241000` / `202606241001` 之一），**不可降级**。
5. **为 task-04 锚定 down_revision**：确认 head=`202606241001` 后，task-04 新 migration 应写 `down_revision = "202606241001"`（本 task 不写该文件，仅在验收时确认锚点存在）。
6. **不做任何 DB schema 变更**：本任务纯修复版本图拓扑，不增删表/列。

## 接口定义

无代码接口变更。本任务的「接口」是 alembic 版本图拓扑：

| 拓扑节点 | 修复前 | 修复后 |
|---|---|---|
| head 数量 | 0（`alembic heads` 抛 KeyError，无法计算） | 1 |
| head revision | — | `202606241001` |
| `202606281200` 节点 | 存在（坏，引用幻影 `202606281000`） | **不存在** |
| `202606281000` 引用 | 1 处（坏 merge 第二 down） | 0 处 |
| `alembic current` | KeyError 或异常 | 正常输出生产 DB revision |
| task-04 `down_revision` 锚点 | 不可达（坏链阻塞） | `202606241001` 可用 |

## 边界处理

1. **删除前坏 merge 已是叶子节点（无子）**：grep 全局 `down_revision` 引用确认无任何 revision 以 `202606281200` 为父，删除不会产生新的悬空节点。若 execute 时复检发现已有新增 revision 引用 `202606281200`，**停止删除**并上报（说明版本图在 plan 之后被改动，需重新评估）。
2. **生产 DB 是否应用过坏 merge**：坏 merge `upgrade()` 为 `pass`，即便 DB 版本表 `alembic_version` 中存在 `202606281200`，删除文件后 alembic 也会因找不到该 revision 而无法 `current`。此时需在 DB 中手动 `UPDATE alembic_version SET version_num='202606241001'`（或当前真实线性版本）后再验证。execute 前用 `alembic current` 输出 + 直接查 `SELECT version_num FROM alembic_version` 双重核实。**正常情况坏链从未被 apply，DB 中版本号应为线性链上的某个 revision，无需手动改。**
3. **`202606241000` 与 `202606241001` 线性关系确认**：删除 merge 前必须确认二者是父子（`202606241001.down_revision == "202606241000"`）而非两条独立分支。若误判（实际是分叉），删除 merge 会丢失一个分支的合并点，导致版本图断裂。本任务已核实为线性父子（见 `202606280900_add_agent_cache_token_fields.py:13`）。
4. **文件名与 revision id 不一致陷阱**：`202606241001` 的载体文件名是 `202606280900_add_agent_cache_token_fields.py`（不是 `202606241001_*.py`）。execute 时**以文件内 `revision = "..."` 字符串为准**，不可按文件名猜测 revision id。`alembic heads` 输出的也是 revision id（`202606241001`），不是文件名。
5. **`__init__.py` 与 `__pycache__` 不动**：`backend/migrations/versions/__init__.py`（空文件）和 `__pycache__/` 目录保持原样；只删一个 `.py` 源文件。删除后 `__pycache__` 中残留的 `202606281200_merge_multi_heads.cpython-*.pyc` 可忽略（不影响 alembic 扫描，Python 会在下次 import 时按需清理；如强迫症可在删除 `.py` 后 `rm -rf backend/migrations/versions/__pycache__` 让其重建，非必须）。
6. **不允许「修正 merge 的 down_revision」作为替代方案**：design.md §3 Phase 0 备选方案（保留 merge 但改第二参数指向真实 head）已明确**不采用** — 该 merge 的两个 down 本就同链（父子非分叉），merge 无业务意义，删除更干净。execute 不得擅自改为「修正 merge」。
7. **Windows / macOS 路径与命令兼容**：删除用 `rm`（Git Bash 可用）或文件系统 API；不依赖 Unix 专属工具。`alembic` 命令须在 `backend/` 目录（含 `alembic.ini`）下执行，跨平台一致。

## 非目标

- **不**新增任何 migration revision（task-04 才做）。
- **不**修改 `202606241000` / `202606241001` / `202607240900` 等任何保留 revision 的内容。
- **不**改 `alembic.ini` / `env.py` 配置。
- **不**做 DB schema 变更（不加列、不改列、不建/删索引）。
- **不**修正 merge（直接删，见边界 6）。
- **不**清理 DB 的 `alembic_version` 表（除非边界 2 触发的罕见情况）。
- **不**碰前端、auth/admin 业务代码（本任务范围仅 `backend/migrations/versions/`）。

## 参考

- `design.md` §3 Phase 0、§6 风险表、§7 回退
- `plan.md` Wave 1 task-01、任务总表第 41 行、依赖关系图
- `decisions.md` D-005@v1
- 真实文件（执行时以文件内 `revision`/`down_revision` 字符串为准）：
  - `backend/migrations/versions/202606281200_merge_multi_heads.py`（待删，坏 merge）
  - `backend/migrations/versions/202606241000_add_session_rotated_at.py`（`revision="202606241000"`, `down_revision="202607240900"`）
  - `backend/migrations/versions/202606280900_add_agent_cache_token_fields.py`（**文件名≠revision**，内部 `revision="202606241001"`, `down_revision="202606241000"`，删除坏 merge 后即唯一 head）

## TDD 步骤

本任务是基础设施修复（删一个空文件），无传统单元测试可写。采用「命令行验证即测试」的 TDD-lite 流程，**红 → 绿**两阶段用 alembic 命令本身作断言：

### Red（修复前，应失败）

在 `backend/` 目录执行，预期全部失败/异常：

```bash
cd backend
alembic heads        # 预期：KeyError: '202606281000' 或类似（坏 merge 引用幻影 revision）
alembic current      # 预期：同样 KeyError（版本图无法构建）
```

记录 Red 阶段错误信息作为修复前基线。

### Green（修复后，应通过）

执行删除：

```bash
rm backend/migrations/versions/202606281200_merge_multi_heads.py
cd backend
alembic heads        # 预期：单一输出 202606241001 (head)
alembic current      # 预期：正常输出生产 DB 当前 revision（不再 KeyError）
```

### 复核断言（人工核对 = 测试断言）

| 断言 | 命令 / 检查 | 期望 |
|---|---|---|
| 坏文件已删 | `ls backend/migrations/versions/202606281200_merge_multi_heads.py` | No such file |
| 无残留引用 | `grep -rn "202606281200" backend/migrations/` | 无输出 |
| 无幻影引用 | `grep -rn "202606281000" backend/migrations/` | 无输出 |
| 单一 head | `alembic heads`（在 backend/ 下） | 仅 `202606241001` |
| 线性链未断 | `alembic current` | 正常输出，无 KeyError |
| task-04 锚点就绪 | 读 `202606280900_add_agent_cache_token_fields.py` 确认 `revision="202606241001"` | 存在且 head=该 id |

## 验收标准

| 编号 | 验收项 | 验证方法 | 通过标准 |
|---|---|---|---|
| AC-01 | 坏 merge 文件已从仓库删除 | `ls backend/migrations/versions/202606281200_merge_multi_heads.py` | 报 No such file or directory |
| AC-02 | 仓库内零残留引用 `202606281200` | `grep -rn "202606281200" backend/` | 无任何匹配行 |
| AC-03 | 仓库内零残留引用幻影 `202606281000` | `grep -rn "202606281000" backend/` | 无任何匹配行 |
| AC-04 | `alembic heads` 正常执行且唯一 | 在 `backend/` 下 `alembic heads` | 退出码 0，仅输出一行包含 `202606241001`（head） |
| AC-05 | `alembic current` 不再 KeyError | 在 `backend/` 下 `alembic current` | 退出码 0，输出生产 DB 当前 revision（应为线性链上 `202607240900`/`202606241000`/`202606241001` 之一，**不得降级**） |
| AC-06 | 删除前后生产 DB revision 不变 | 对比 AC-05 输出与 Red 阶段（若 Red 能拿到）/ DB 直查 `SELECT version_num FROM alembic_version` | revision 号未因删文件而改变（坏 merge 本就未被 apply） |
| AC-07 | 保留 revision 内容未被改动 | `git diff -- backend/migrations/versions/202606241000_add_session_rotated_at.py backend/migrations/versions/202606280900_add_agent_cache_token_fields.py backend/migrations/versions/202607240900_add_user_username.py` | 无 diff（仅删坏 merge 一个文件） |
| AC-08 | task-04 锚点已就绪 | 读 `backend/migrations/versions/202606280900_add_agent_cache_token_fields.py` 的 `revision` 字段 | 等于 `202606241001`，且 = AC-04 的 head，可供 task-04 写 `down_revision="202606241001"` |
| AC-09 | 范围未越界 | `git status --short` | 仅 `D  backend/migrations/versions/202606281200_merge_multi_heads.py` 一条删除记录，无其他改动 |
| AC-10 | 不影响 alembic 其他配置 | `git diff -- backend/alembic.ini backend/migrations/env.py` | 无 diff |
