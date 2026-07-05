---
id: task-02
title: resolve_prompt_spec_root helper + build_scan_bundle 按 transport 分支（shared 宿主路径保持现状，tar 用 daemon 本地路径 ~/.sillyhub/daemon/specs/{ws}）
phase: W1
priority: P0
status: draft
owner: qinyi
estimated_hours: 2
depends_on:
  - task-01
blocks:
  - task-08
  - task-10
requirement_ids:
  - FR-02
  - FR-03
decision_ids:
  - D-001@v1
  - D-004@v1
  - D-006@v1
allowed_paths:
  - backend/app/modules/agent/context_builder.py
author: qinyi
created_at: 2026-06-23 11:20:01
---

## 1. 目标

在 `backend/app/modules/agent/context_builder.py` 新增 helper
`resolve_prompt_spec_root(transport, ws_id, settings)`，并让 `build_scan_bundle`
（行 423-589）按 transport 分支决定塞入 prompt 的 `--spec-root` / `--runtime-root`
路径：

- **shared 模式**（默认）：保持现状宿主路径 `spec_data_host_dir/{ws}`（D-004 向后兼容，
  bind mount 同机拓扑，行为零改动）。
- **tar 模式**（异机）：改用 daemon 本地约定路径 `~/.sillyhub/daemon/specs/{ws}`，
  与 daemon 侧 `spec-sync.resolveSpecDir(wsId)` 输出一致（task-04 / D-007），tilde 由
  daemon SessionManager spawn 环境展开（design §10 R-01，daemon 侧 task-06 处理）。

**双轨保留（D-006）**：`bundle.spec_root` / `platform_metadata.spec_root` / `bundle.runtime_root`
仍用入参容器路径（`spec_root` / `runtime_root` 参数），**不随 transport 改变**——它们
代表 backend 视角的权威源路径，供 backend 内部 post-check / scan_sync / metadata 使用。
只有 prompt 里跑在 daemon 机器上的 `--spec-root` / `--runtime-root` 按 transport 分支。

**不在范围（非目标）**：

- 不改 `bundle.spec_root` / `platform_metadata.spec_root` 的语义（仍为入参容器路径）。
- 不改 `build_claim_payload`（task-03 范围）。
- 不改 `start_stage_dispatch` 的 `platform_args`（task-10 范围，Wave 2，本 task 不碰）。
- 不展开 tilde（`~`）——展开由 daemon 侧 spawn 环境 HOME 负责（R-01，daemon task-06）。
  本 helper 只产出字面量 `~/.sillyhub/daemon/specs/{ws}`。
- 不改 `init_cmd` 逻辑（`sillyspec init` 跳过判断，platform_mode 不变）。

## 2. 覆盖来源

| 类型 | 来源 |
|---|---|
| 需求 | `requirements.md` FR-02（shared 零改动）、FR-03（tar 模式 prompt 用 daemon 本地路径 + 双轨） |
| 决策 | `decisions.md` D-001@v1（transport 正交 strategy，走全局 config）、D-004@v1（shared 现状完全保留）、D-006@v1（双轨 prompt + 不改 build_scan_bundle 双轨字段语义） |
| 设计 | `design.md` §5.0 核心机制表、§7.1 helper 接口定义、§10 R-01（tilde 展开 daemon 侧）、§11 决策追踪 |
| 测试契约 | `plan.md` SC-5（test_context_builder 重写按 transport 分支断言，task-08 实现） |
| 真实代码 | `context_builder.py` 行 423-589（`build_scan_bundle`），重点 467-487 `host_spec_root` / `host_runtime_root` / `scan_start_cmd`；行 13 `get_settings` 已 import；行 550-577 bundle 组装（双轨字段） |

## 3. 修改文件

仅一个文件：`backend/app/modules/agent/context_builder.py`

| 位置 | 改动 |
|---|---|
| 新增（建议置于 `build_scan_bundle` 函数之前，行 ~417 附近，紧接"Scan bundle builder"section 注释后） | `resolve_prompt_spec_root` helper 函数（纯函数，无 IO） |
| `build_scan_bundle` 行 467-469 | `host_spec_root` / `host_runtime_root` 改为调 helper（tar 分支返回 daemon 本地路径） |
| `build_scan_bundle` 行 502 / 508 / 510（platform_mode prompt 文案里的 `{host_spec_root}` 占位） | 跟随 `host_spec_root` 变量自动反映分支值，无需单独改（变量复用） |
| `build_scan_bundle` 行 550-577（bundle / platform_metadata 组装） | **不改** —— `spec_root=spec_root`、`platform_metadata["spec_root"]=spec_root`、`runtime_root=runtime_root` 保持入参容器路径（D-006 双轨） |

> 注：`Settings` 类型注解需要 import。当前文件只 import 了 `get_settings`（行 13）。
> 实现时补充 `from app.core.config import Settings, get_settings`（或用
> `from app.core.config import get_settings` + `TYPE_CHECKING` 下注解 Settings，避免运行时
> 循环 import 风险——plan 阶段实现时按 codebase 现有惯例选其一，task-01 已在 config.py 定义
> `spec_transport` 字段，`Settings` 是 pydantic BaseSettings 子类可直接 import）。

## 4. 接口定义

### 4.1 helper 函数（design §7.1 展开）

```python
def resolve_prompt_spec_root(
    transport: str, ws_id: str, settings: Settings
) -> str:
    """按 transport 决定塞进 prompt 的 --spec-root 路径。

    用于 scan / stage dispatch 生成 sillyspec 命令时选择 daemon 机器上能访问到的
    spec 目录路径。**只影响 prompt 文本**，不影响 bundle.spec_root /
    platform_metadata.spec_root（后者始终为 backend 入参容器路径，见 D-006 双轨）。

    分支（design §5.0 表 + §7.1）：
    - shared（默认，D-004 向后兼容）：返回宿主路径
      ``{settings.spec_data_host_dir}/{ws_id}``（生产 ``C:/data/spec-workspaces/<uuid>``）。
      daemon 与 backend 同机 + Docker bind mount 共享同一物理盘，backend 经容器路径
      ``/data/{ws}`` 看到同一物理目录。
    - tar（异机，D-003/D-007）：返回 daemon 本地约定路径
      ``~/.sillyhub/daemon/specs/{ws_id}``。与 daemon ``spec-sync.resolveSpecDir(wsId)``
      输出一致（task-04）；tilde 由 daemon SessionManager spawn 环境 HOME 展开
      （design §10 R-01，daemon task-06 确认/兜底）。tar 模式下 daemon session 开始时
      ``pullSpecBundle`` 拉 backend spec bundle 解到该路径，session 终态 ``postSpecSync``
      把产出整树 tar 回传 backend（task-06）。
    - 非法值（非 'shared'/'tar'）：回退 shared 分支（保守默认，避免 prompt 拼出非法路径
      导致 sillyspec 写盘失败；task-01 field_validator 已在 Settings 层规范化，此处仅作
      防御性兜底，记 warn 日志）。

    Args:
        transport: transport 模式，取自 ``settings.spec_transport``（task-01 定义）。
        ws_id: workspace ID 字符串（``str(workspace_id)``）。
        settings: 全局 Settings 实例（``get_settings()``），读取 ``spec_data_host_dir``。

    Returns:
        塞入 prompt 的 ``--spec-root`` 路径字符串。**不展开 tilde**（tar 分支返回字面量
        ``~``，展开在 daemon 侧）。
    """
    if transport == "tar":
        return f"~/.sillyhub/daemon/specs/{ws_id}"
    if transport != "shared":
        log.warning(
            "prompt_spec_root_unknown_transport_fallback_shared",
            transport=transport,
        )
    return f"{settings.spec_data_host_dir}/{ws_id}"
```

### 4.2 build_scan_bundle 改动（行 467-469 替换）

**改动前**（行 467-469）：

```python
settings = get_settings()
host_spec_root = f"{settings.spec_data_host_dir}/{ws_id}"
host_runtime_root = f"{host_spec_root}/runtime"
```

**改动后**：

```python
settings = get_settings()
# 按 transport 分支决定塞入 prompt 的路径（design §5.0 表 + §7.1 helper）。
# 注意：host_spec_root 仅用于 prompt 文本（daemon 机器跑 sillyspec 时能访问的路径），
# bundle.spec_root / platform_metadata.spec_root 仍用入参容器路径（D-006 双轨）。
host_spec_root = resolve_prompt_spec_root(settings.spec_transport, ws_id, settings)
host_runtime_root = f"{host_spec_root}/runtime"
```

**后续行 480-487** `scan_start_cmd` 用 `host_spec_root` / `host_runtime_root` 拼命令，
**变量名不变、引用不变**——分支值通过 helper 注入，拼出来的命令自动是 tar 或 shared 的
正确路径。`platform_mode` prompt 文案（行 502/508/510 `{host_spec_root}` 占位）同理自动
反映分支值，**无需单独改文案**。

### 4.3 双轨字段保留说明（D-006 核心，不改）

`build_scan_bundle` 行 550-577 的 bundle 组装**保持原样**：

```python
bundle = AgentSpecBundle(
    ...
    platform_metadata={
        ...
        "spec_root": spec_root,          # ← 入参容器路径，不改
        "runtime_root": runtime_root,    # ← 入参容器路径，不改
        ...
    },
    ...
    spec_root=spec_root,                 # ← 入参容器路径，不改（D-006）
    runtime_root=runtime_root,           # ← 入参容器路径，不改
    ...
)
```

理由：方案 B（commit `fcbf3fa7`）的故意双轨设计——prompt 路径是「daemon 机器跑 sillyspec
时访问的物理路径」（随 transport 变），bundle / metadata 的 spec_root 是「backend 视角
的权威源路径」（容器 `/data/{ws}`，bind mount 下与宿主路径同物理目录，tar 模式下由
apply_sync 解 tar 写入）。两者经不同机制对齐到同一物理目录，改任一会破坏方案 B 或
tar 回传链路。

## 5. 边界处理

| # | 场景 | 处理 |
|---|---|---|
| B-01 | **shared 分支零改动（D-004 核心）** | helper shared 分支返回 `f"{settings.spec_data_host_dir}/{ws_id}"`，与改动前行 468 字面量**完全一致**。`transport` 未配置（task-01 默认 shared）时拼出的 prompt 与现状逐字符相同，现有同机 bind mount 部署零影响。验收 AC-01/AC-02 用「prompt 字符串 diff 为空」守护。 |
| B-02 | **tar 分支 tilde 不展开** | helper 返回字面量 `~/.sillyhub/daemon/specs/{ws}`，不在 backend Python 侧 `os.path.expanduser`——daemon 与 backend 异机，backend 的 HOME 无意义。展开由 daemon SessionManager spawn 环境 HOME 负责（design §10 R-01），daemon task-06 确认 spawn-env HOME 可靠，否则 daemon 在注入 sillyspec 命令前用 `os.homedir()` 展开。本 helper 只负责产出 daemon 能识别的占位路径。 |
| B-03 | **双轨 bundle.spec_root 不随 transport 变（D-006）** | `bundle.spec_root` / `platform_metadata.spec_root` / `bundle.runtime_root` 始终绑定入参 `spec_root` / `runtime_root`（容器路径），helper 只影响 prompt 局部变量 `host_spec_root`。验收 AC-05 守护：tar 模式下 `bundle.spec_root` 仍是入参容器路径（不含 `~/.sillyhub`）。 |
| B-04 | **runtime_root 同理按 transport 分支** | `host_runtime_root = f"{host_spec_root}/runtime"` 派生自 `host_spec_root`，自动跟随分支（shared → 宿主路径 `/runtime`，tar → `~/.sillyhub/daemon/specs/{ws}/runtime`）。`bundle.runtime_root`（入参）不变。这与 sillyspec `--runtime-root` 的语义一致（runtime 目录是 spec_root 子目录）。 |
| B-05 | **transport 非法值（非 shared/tar）回退 shared** | task-01 的 `field_validator` 已在 Settings 层把非法值规范化（默认 shared 或报错，task-01 定）。本 helper 作为防御性兜底：若传入非 `'shared'`/`'tar'`（例如调用方手误传 None 或空串），走 shared 分支 + `log.warning` 记录，**不抛异常**——避免 prompt 生成阶段因 transport 异常中断 scan dispatch（保守默认优于失败）。 |
| B-06 | **ws_id 字符串化** | helper 入参 `ws_id: str`，调用方 `build_scan_bundle` 已在行 461 `ws_id = str(workspace_id)`，无需 helper 内重复 `str()`。helper 不做 UUID 格式校验（不是它的职责）。 |
| B-07 | **host_spec_root 在 platform_mode 文案中被多次引用** | 行 502/508/510 等 prompt 文案用 `{host_spec_root}` f-string 占位，变量改值后所有引用自动一致，无需逐处改。实现时确认无遗漏的硬编码路径（grep `spec_data_host_dir` 确认仅行 468 一处消费点——plan.md 调用点搜索已确认 `context_builder.py:468` 是唯一 scan 侧消费点）。 |

## 6. 非目标（明确不做）

- **不改 `bundle.spec_root` / `platform_metadata.spec_root` / `bundle.runtime_root` 语义**（D-006）。
  这些字段始终为入参容器路径，helper 只改 prompt 局部变量。
- **不展开 tilde**（`~`）——backend 侧无 HOME 语义，展开在 daemon task-06。
- **不改 `init_cmd` / `is_platform_mode` 逻辑**（行 476-479）——sillyspec init 跳过判断
  与 transport 无关。
- **不改 `build_claim_payload`**（task-03 范围）——本 task 不透传 transport/workspace_id。
- **不改 `start_stage_dispatch` 的 `platform_args`**（task-10 / Wave 2 范围）——本 task 只
  覆盖 scan；stage 复用同一 helper 但改的是 `service.py`，属于 task-10。
- **不新增 transport 入库字段**（D-001）——transport 只从 `settings.spec_transport` 读。
- **不做 transport 切换数据迁移**（D-005）。

## 7. 参考

- `design.md` §5.0（核心机制表：transport × prompt --spec-root × daemon 路径 × spec 同步）
- `design.md` §7.1（helper 接口签名 + 分支说明）
- `design.md` §10 R-01（tilde/HOME 展开风险，daemon task-06 应对）
- `design.md` §11（决策追踪：D-001/D-004/D-006 映射）
- `decisions.md` D-001@v1（transport 正交 strategy，全局 config 不入库）
- `decisions.md` D-004@v1（shared 完全保留现状）
- `decisions.md` D-006@v1（双轨 prompt + 过时断言随重写，不改双轨代码）
- `requirements.md` FR-02（shared 零改动）、FR-03（tar prompt daemon 本地路径 + 双轨）
- `plan.md` SC-5（test_context_builder 重写契约，task-08 实现）
- 真实代码 `context_builder.py:423-589`（build_scan_bundle）、`:13`（get_settings import）、
  `:467-469`（host_spec_root/host_runtime_root 消费点）、`:550-577`（双轨 bundle 组装）

## 8. TDD（测试由 task-08 落地，本 task 仅定义契约）

本 task **不写测试**（测试属 task-08 `test_context_builder.py` 修正 + 新增范围，D-006 改测试
不改代码）。本 task 定义 task-08 须满足的契约：

| 测试用例（task-08 实现） | 断言 |
|---|---|
| `test_resolve_prompt_spec_root_shared` | `transport="shared"` → 返回 `f"{settings.spec_data_host_dir}/{ws_id}"`，与改动前行 468 字面量逐字符一致 |
| `test_resolve_prompt_spec_root_tar` | `transport="tar"` → 返回 `f"~/.sillyhub/daemon/specs/{ws_id}"`，tilde 不展开（字面量 `~`） |
| `test_resolve_prompt_spec_root_unknown_fallback_shared` | `transport="bogus"` → 回退 shared 分支 + 记 warn |
| `test_build_scan_bundle_prompt_tar_contains_daemon_local_path`（重写行 142） | `settings.spec_transport="tar"` 时 prompt 含 `~/.sillyhub/daemon/specs/{ws}`，**不含**宿主路径 `spec_data_host_dir` |
| `test_build_scan_bundle_prompt_shared_contains_host_path`（重写行 162） | `settings.spec_transport="shared"` 时 prompt 含 `f"{spec_data_host_dir}/{ws_id}"`，与现状一致 |
| `test_build_scan_bundle_dual_track_spec_root_unchanged`（D-006 守护，新增） | tar 模式下 `bundle.spec_root` == 入参 `spec_root`（容器路径），`platform_metadata["spec_root"]` == 入参 `spec_root`，**不含** `~/.sillyhub` |

> 实现顺序（CLAUDE.md 执行顺序）：先确认 task-01 已落地（`settings.spec_transport` 可读）
> → 写 helper → 改 `build_scan_bundle` 行 467-469 → 跑 task-08 测试 → mypy + ruff。

## 9. 验收标准（每条可点击验证）

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `cd backend && uv run pytest backend/tests/modules/agent/test_context_builder.py -k shared` | shared 模式 prompt 含 `f"{spec_data_host_dir}/{ws_id}"`，**与改动前逐字符一致**（D-004 向后兼容，零回归） |
| AC-02 | git diff `context_builder.py` 仅命中「新增 helper 函数 + 行 467-469 改调 helper」，**无 bundle/platform_metadata 字段改动** | shared 分支行为完全不变（D-004），双轨字段未动（D-006） |
| AC-03 | `cd backend && uv run pytest backend/tests/modules/agent/test_context_builder.py -k tar` | tar 模式 prompt `--spec-root` 值 == `~/.sillyhub/daemon/specs/{ws}`，`--runtime-root` == `~/.sillyhub/daemon/specs/{ws}/runtime`，tilde 未展开 |
| AC-04 | grep `~/.sillyhub` in tar 模式生成的 prompt | 命中 1 处（`--spec-root`），且 prompt 文案中 `{host_spec_root}` 占位处全部替换为 tar 路径，无宿主路径残留 |
| AC-05 | `cd backend && uv run pytest backend/tests/modules/agent/test_context_builder.py -k dual_track` | tar 模式下 `bundle.spec_root` == 入参 `spec_root`（容器路径 `/data/...`），`platform_metadata["spec_root"]` == 入参 `spec_root`，`bundle.runtime_root` == 入参 `runtime_root`——双轨字段不随 transport 变（D-006） |
| AC-06 | `cd backend && uv run pytest backend/tests/modules/agent/test_context_builder.py -k unknown_fallback` | `transport="bogus"` → helper 回退 shared 分支 + log warn，不抛异常，prompt 含宿主路径 |
| AC-07 | `cd backend && uv run pytest`（全量） | 全部通过，无现有测试回归（含 task-08 重写后的断言） |
| AC-08 | `cd backend && uv run mypy app` + `uv run ruff check .` | 0 error（含 helper 类型注解 `transport: str, ws_id: str, settings: Settings -> str`） |
| AC-09 | helper 函数为纯函数（无 IO、无 DB、无网络） | grep 确认 `resolve_prompt_spec_root` 函数体内无 `await` / `session` / `http` / `open(`，可独立单测 |
| AC-10 | `get_settings()` 调用次数不变 | `build_scan_bundle` 内 `get_settings()` 仍调用 1 次（行 467），helper 接收已构造的 `settings` 实例，不重复调用 |

## 10. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 改动行 467-469 时误伤双轨字段（改了 bundle.spec_root） | 破坏方案 B 双轨设计，tar 回传链路错乱 | AC-02 + AC-05 守护；git diff 严格限定 helper 新增 + 行 467-469 替换两处 |
| tar 模式 tilde 在 backend 侧被误展开 | prompt 里出现 backend HOME 路径，daemon 跑 sillyspec 写错位置 | helper 不调 `expanduser`（B-02）；测试 AC-03 断言字面量 `~` |
| task-01 未先落地（`settings.spec_transport` 不存在） | helper 调用 `AttributeError` | depends_on: task-01；实现前确认 `config.py` 有 `spec_transport` 字段 |
| `Settings` import 引入循环依赖 | ImportError 启动失败 | 按 codebase 现有惯例（`get_settings` 已从 `app.core.config` import），Settings 同模块可直接 import；若 mypy 报循环，用 `TYPE_CHECKING` 守护注解 |
| shared 分支字符串拼接与原行 468 不完全一致 | 隐性回归，同机部署 prompt 路径变化 | AC-01 用「逐字符一致」断言；helper shared 分支 return 表达式与原行 468 右值**完全相同**（`f"{settings.spec_data_host_dir}/{ws_id}"`） |

## 11. 完成定义（DoD）

- [ ] 10 个 AC 全部通过（含 shared 零回归 AC-01/AC-02 + tar AC-03/AC-04 + 双轨 AC-05）
- [ ] `cd backend && uv run pytest` 全量通过（含 task-08 新增/重写测试）
- [ ] `cd backend && uv run mypy app` + `uv run ruff check .` 通过
- [ ] git diff 仅命中 `context_builder.py`，改动范围 = 新增 helper + 行 467-469 替换
- [ ] D-001（transport 走 config 不入库）、D-004（shared 现状不变）、D-006（双轨字段不动）
      三项决策在验收中显式验证通过
- [ ] unblock task-08（测试修正）与 task-10（stage prompt 复用 helper）
