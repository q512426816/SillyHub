---
id: task-08
title: 修正 test_context_builder 行142/162 过时断言 + transport 分支断言（覆盖：FR-08, D-006@v1）
priority: P0
estimated_hours: 2
depends_on: [task-02]
blocks: []
requirement_ids: [FR-08]
decision_ids: [D-006@v1]
allowed_paths:
  - backend/tests/modules/agent/test_context_builder.py
author: qinyi
created_at: 2026-06-23 11:20:01
---

# task-08 / 修改测试文件 / 覆盖来源 / 实现要求

## 目标

修正 `backend/tests/modules/agent/test_context_builder.py` 中行 142 / 行 162 的过时
断言，并新增 transport 双模式分支断言，使其与 task-02 引入的
`resolve_prompt_spec_root(transport, ws_id, settings)` helper 行为对齐。

**本任务只改测试，不改任何产品代码**（D-006@v1 明确决策：`build_scan_bundle` 的双轨
设计——prompt 用宿主路径、`bundle.spec_root`/`platform_metadata.spec_root` 用入参
容器路径——是方案 B commit `fcbf3fa7` 的故意设计，经 bind mount 同一物理目录，改代码
会破坏方案 B）。

## 覆盖来源

- **需求**：FR-08（测试修正 / transport 分支断言）
- **决策**：D-006@v1（改测试不改代码）
- **设计**：design.md §6 文件变更清单（行 140-141）、§11 决策追踪表 D-006@v1、§13
  Cross-Check Matrix（本任务为纯测试修正，无独立 X 项，但受 X-001 修正后的 helper 签名
  约束）
- **计划**：plan.md Wave 1 task-08（依赖 task-02）
- **验收标准**：SC-5（行 142/162 重写后按 transport 分支断言通过）

## 实现要求

### 背景：为什么旧断言过时（D-006@v1）

当前 `build_scan_bundle`（`context_builder.py:467-487`）的 prompt `--spec-root` **不
使用入参 `spec_root`**，而是用 config 宿主路径推导：

```python
# context_builder.py:467-469（现状）
settings = get_settings()
host_spec_root = f"{settings.spec_data_host_dir}/{ws_id}"
host_runtime_root = f"{host_spec_root}/runtime"
# context_builder.py:483-484 prompt 实际写入
f" --spec-root {host_spec_root}"
f" --runtime-root {host_runtime_root}"
```

因此旧测试断言 `assert "--spec-root /data/specs/ws-abc" in bundle.step_prompt`
（行 142，入参值）在生产代码下：

- 当 `settings.spec_data_host_dir == "/data/specs"` 时**偶然通过**（路径恰好拼接出
  `/data/specs/<ws_id>`，但 `<ws_id>` 是真实 UUID 而非 `ws-abc`，实际仍会失败）；
- 否则直接失败。

行 162 `expected_runtime = str(Path("/data/specs/ws-abc") / "runtime")` 同理——
runtime_root 也走宿主路径推导，不入参。

**fixtures 现状**：`mock_session`（行 17-19）/`mock_workspace`（行 22-29，`ws.id` 为
真实 `uuid.uuid4()`）均未 mock settings，走真实 `get_settings()`。这是旧断言不稳定的
根因——测试结果取决于运行环境 `SPEC_DATA_HOST_DIR` env 值。

### task-02 完成后的新行为

task-02 引入 helper（design §7.1）：

```python
def resolve_prompt_spec_root(transport: str, ws_id: str, settings) -> str:
    if transport == "tar":
        return f"~/.sillyhub/daemon/specs/{ws_id}"
    return f"{settings.spec_data_host_dir}/{ws_id}"
```

`build_scan_bundle` 内 `host_spec_root` / `host_runtime_root` 改由 helper + settings
推导（tar 模式 runtime_root 同样基于 daemon 本地路径）。本任务需把测试断言对齐到这个
分支行为。

### 行 142 / 行 162 重写

把单一断言改为**参数化双分支**：

- **shared 分支**：mock `settings.spec_transport = "shared"` +
  `settings.spec_data_host_dir = "/test/host/specs"`（固定值，消除环境依赖），断言
  prompt 含 `--spec-root /test/host/specs/{ws_id}`（`ws_id` 取 `mock_workspace.id`，
  真实 UUID）。
- **tar 分支**：mock `settings.spec_transport = "tar"`，断言 prompt 含
  `--spec-root ~/.sillyhub/daemon/specs/{ws_id}`。
- runtime_root 同理按分支断言：shared 含
  `/test/host/specs/{ws_id}/runtime`，tar 含
  `~/.sillyhub/daemon/specs/{ws_id}/runtime`（与 task-02 helper 对 runtime 的推导口径
  一致；若 task-02 runtime 推导口径与 spec_root 分支不同，以 task-02 实现为准，本任务
  断言口径跟随实现——实现时读 task-02 的 helper 源码确认）。

### 新增 transport 参数化测试

新增 `test_build_scan_bundle_prompt_spec_root_by_transport`（参数化 `shared`/`tar`
两个 case），替代旧的单一断言测试 `test_build_scan_bundle_prompt_contains_spec_root`
（行 127-142）。`test_build_scan_bundle_prompt_contains_runtime_root`（行 145-162）
同理并入参数化用例或独立保留双分支。

### 保留不变的双轨断言

`bundle.spec_root`（行 64）、`bundle.platform_metadata["spec_root"]`（行 311）仍断言
**入参值** `/data/specs/ws-123` / `/data/specs/ws-abc`——这是方案 B 双轨设计的核心
（bundle 字段用容器路径、prompt 用宿主路径），**不动**。

## 接口定义

### 修改的测试函数

```python
# 行 127-142 — 替换为参数化双分支
@pytest.mark.parametrize("transport,expected_spec_root_substr", [
    ("shared", None),    # 占位，实际在用例内拼接 host 路径
    ("tar", None),       # 占位，实际在用例内拼接 daemon 本地路径
])
@pytest.mark.asyncio
async def test_build_scan_bundle_prompt_spec_root_by_transport(
    mock_session, mock_workspace, sample_run_id,
    monkeypatch, transport, expected_spec_root_substr
):
    """step_prompt 的 --spec-root 按 transport 分支：
    shared → settings.spec_data_host_dir/{ws_id}；
    tar    → ~/.sillyhub/daemon/specs/{ws_id}。
    覆盖 D-006@v1：改测试不改代码。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)
    ws_id = str(mock_workspace.id)

    # mock settings：固定 spec_transport + spec_data_host_dir，消除环境依赖
    _mock_settings(monkeypatch, transport=transport,
                   spec_data_host_dir="/test/host/specs")

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/specs/ws-abc",   # 入参（容器路径，仅 bundle 字段用）
        root_path="/home/user/project",
        run_id=sample_run_id,
    )

    if transport == "shared":
        expected = f"--spec-root /test/host/specs/{ws_id}"
    else:  # tar
        expected = f"--spec-root ~/.sillyhub/daemon/specs/{ws_id}"
    assert expected in bundle.step_prompt
```

### mock settings 的方式

fixtures 当前未 mock settings（走真实 `get_settings()`）。本任务用 **pytest
`monkeypatch`**（不引入新 fixture，避免污染其他 14 个测试用例）：

```python
# 测试模块顶部或用例内
def _mock_settings(monkeypatch, *, transport: str, spec_data_host_dir: str) -> None:
    """monkeypatch get_settings 返回固定 transport + spec_data_host_dir 的假 settings。

    用 monkeypatch 而非新 fixture：作用域限本用例，自动还原，
    不影响同文件其他不依赖 transport 的测试（如 preflight 测试行 390+）。"""
    from app.core import config
    from unittest.mock import MagicMock
    fake = MagicMock()
    fake.spec_transport = transport
    fake.spec_data_host_dir = spec_data_host_dir
    monkeypatch.setattr(config, "get_settings", lambda: fake)
    # 同时 patch context_builder 模块内已 import 的 get_settings 符号
    # （context_builder.py:13 `from app.core.config import get_settings`）
    monkeypatch.setattr(
        "app.modules.agent.context_builder.get_settings", lambda: fake
    )
```

> **关键点**：`context_builder.py:13` 是 `from app.core.config import get_settings`
> 形式 import，符号已绑定到 `context_builder` 模块命名空间。必须同时 patch
> `app.modules.agent.context_builder.get_settings`（被测模块内的引用），仅 patch
> `app.core.config.get_settings` 不会生效。实现时先读 `context_builder.py` 顶部
> import 行确认绑定形式。

### 备选：dependency_overrides

不采用 FastAPI `dependency_overrides`——`get_settings` 不是 FastAPI Depends，是普通
函数调用，`dependency_overrides` 无效。`monkeypatch` 是唯一正确路径。

## 边界处理

1. **不改任何产品代码**：本任务 allowed_paths 仅
   `backend/tests/modules/agent/test_context_builder.py` 一个文件。若发现
   `build_scan_bundle` 行为与 design/task-02 描述不符，**不在此任务修代码**，而是回退到
   task-02 修正 helper，本任务断言口径跟随 task-02 实现。

2. **mock settings 不污染其他测试**：用 `monkeypatch`（函数级自动还原），不新增
   session/module 级 fixture。同文件其他 14 个不依赖 transport 的测试（如
   `test_build_scan_bundle_success` 行 44、preflight 测试行 390+）行为不变。

3. **ws_id 是真实 UUID**：`mock_workspace.id = uuid.uuid4()`（行 26），断言中
   `--spec-root` 路径的 ws 段必须用 `str(mock_workspace.id)` 动态拼接，**不硬编码**
   `ws-abc`（这正是旧断言的过时来源——硬编码入参值而非真实推导值）。

4. **双轨 bundle.spec_root 仍断言入参**：行 64 `assert bundle.spec_root ==
   "/data/specs/ws-123"`、行 311 `assert meta["spec_root"] == "/data/specs/ws-abc"`
   保持不变（方案 B 双轨：bundle 字段容器路径、prompt 宿主路径）。本任务**不碰**这两
   处断言。

5. **shared/tar 两个分支独立用例**：用 `@pytest.mark.parametrize` 生成两个独立测试
   ID（`test_..._[shared]` / `test_..._[tar]`），任一分支失败能独立定位，不互相掩盖。

6. **runtime_root 推导口径跟随 task-02**：若 task-02 helper 对 tar 模式 runtime_root
   的推导（是否在 daemon 本地路径下加 `/runtime`）与 spec_root 分支不一致，以 task-02
   实现为准——本任务先读 task-02 helper 源码确认口径再写断言，不臆测。

## 非目标

- **不改 `build_scan_bundle`**（D-006@v1：改代码破坏方案 B 双轨设计）。
- **不碰 `platform_metadata` 断言**（行 311 `meta["spec_root"] ==
  "/data/specs/ws-abc"` 保持，metadata 用入参容器路径）。
- **不新增 `build_claim_payload` / daemon spec-sync 测试**（那些属于 task-09 scope）。
- **不补 stage prompt 测试**（属于 task-10/task-11 scope，本任务仅 scan 链路
  `build_scan_bundle`）。
- **不引入 conftest.py 全局 settings fixture**（YAGNI，monkeypatch 已足够）。

## 参考

- `backend/tests/modules/agent/test_context_builder.py` 行 16-35（fixtures）、行 64
  （bundle.spec_root 入参断言，保留）、行 127-162（待重写）、行 202-264（其他 prompt
  断言，保留）、行 295-314（platform_metadata 断言，保留）
- `backend/app/modules/agent/context_builder.py:467-487`（prompt 用宿主路径的根因）、
  `:13`（`from app.core.config import get_settings` import 绑定形式）、`:550-577`
  （bundle 字段用入参 spec_root，双轨）
- design.md §7.1（helper 签名）、§6 行 140-141（本任务文件变更清单）、§11 D-006@v1
- decisions.md D-006@v1（改测试不改代码的决策依据 + evidence）
- commit `fcbf3fa7`（方案 B 双轨设计的原始引入）

## TDD 流程

本任务即测试任务，TDD 流程为「先确认旧断言失败/不稳定 → 重写 → 通过」：

1. **Red（确认过时）**：在 task-02 完成前，跑现有
   `test_build_scan_bundle_prompt_contains_spec_root`——若环境
   `SPEC_DATA_HOST_DIR` 非默认值或 ws_id 不匹配 `ws-abc`，断言失败，证实过时。
2. **依赖 task-02**：本任务 `depends_on: [task-02]`，需 task-02 先落地 helper +
   `build_scan_bundle` 分支改造，本任务断言才有目标行为可验。
3. **Green（重写）**：按「实现要求」重写行 142/162 + 新增参数化用例，mock settings
   后两分支断言通过。
4. **全量回归**：`cd backend && uv run pytest backend/tests/modules/agent/
   test_context_builder.py -v` 全部通过（含未改的 14 个用例），证实 mock 未污染。

## 验收

| AC ID | 验收项 | 验证方式 |
|---|---|---|
| AC-1 | 行 142 旧断言 `--spec-root /data/specs/ws-abc`（入参硬编码）已移除 | grep
  `ws-abc` 在 step_prompt 断言中不再出现（bundle.spec_root 行 64 的入参断言除外） |
| AC-2 | 行 162 旧断言 `Path("/data/specs/ws-abc") / "runtime"` 已移除 | 同上，runtime
  断言改为按 transport 分支动态拼接 |
| AC-3 | shared 分支：mock `spec_transport="shared"` +
  `spec_data_host_dir="/test/host/specs"`，断言 prompt 含
  `--spec-root /test/host/specs/{ws_id}`（ws_id 真实 UUID） | 参数化用例 shared case
  通过 |
| AC-4 | tar 分支：mock `spec_transport="tar"`，断言 prompt 含
  `--spec-root ~/.sillyhub/daemon/specs/{ws_id}` | 参数化用例 tar case 通过 |
| AC-5 | mock settings 用 monkeypatch，作用域限本用例，不影响同文件其他 14 个测试 |
  `pytest backend/tests/modules/agent/test_context_builder.py -v` 全绿 |
| AC-6 | `bundle.spec_root`（行 64）/ `platform_metadata["spec_root"]`（行 311）入参
  断言保持不变（双轨设计未破坏） | diff 确认这两处未改 |
| AC-7 | 未修改 `build_scan_bundle` 及任何产品代码（D-006@v1） | `git diff --stat`
  仅 `test_context_builder.py` 一个文件 |
| SC-5 | 行 142/162 重写后按 transport 分支断言通过 | AC-3 + AC-4 合并即 SC-5 |

**全部 AC 满足 + `cd backend && uv run pytest backend/tests/modules/agent/
test_context_builder.py` 全绿 = task-08 完成。**
