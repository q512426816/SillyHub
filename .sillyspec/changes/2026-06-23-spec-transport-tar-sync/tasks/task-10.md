---
id: task-10
title: start_stage_dispatch platform_args 按 transport 分支（复用 task-02 helper，tar 用 daemon 本地路径 ~/.sillyhub/daemon/specs/{ws}，propose/plan/execute 经 interactive 自动复用 Wave1 spec-sync 无需改 daemon）
phase: W2
priority: P1
status: draft
owner: qinyi
estimated_hours: 1
depends_on:
  - task-02
blocks:
  - task-11
requirement_ids:
  - FR-03
decision_ids:
  - D-001@v1
allowed_paths:
  - backend/app/modules/agent/service.py
author: qinyi
created_at: 2026-06-23 11:20:01
---

## 1. 目标

把 `start_stage_dispatch`（`backend/app/modules/agent/service.py` 行 929-1134）里拼接
`platform_args`（行 1006-1023）的宿主路径 `host_spec_root`/`host_runtime_root` 改为复用
task-02 在 `context_builder.py` 新增的 `resolve_prompt_spec_root(transport, ws_id, settings)`
helper，按 transport 分支决定塞入 propose/plan/execute 等 stage 命令里的 `--spec-root` /
`--runtime-root` 路径：

- **shared 模式**（默认）：保持现状宿主路径 `spec_data_host_dir/{ws}`（D-004 向后兼容，
  与改动前行 1017 字面量逐字符一致，同机 bind mount 行为零改动）。
- **tar 模式**（异机）：改用 daemon 本地约定路径 `~/.sillyhub/daemon/specs/{ws}`，与
  `context_builder.build_scan_bundle` 的 tar 分支输出一致（task-02），也与 daemon 侧
  `spec-sync.resolveSpecDir(wsId)` 输出一致（task-04 / D-007）。

**核心连带收益（X-001 修正后的天然落点）**：`start_stage_dispatch` 经
`placement.dispatch_to_daemon`（行 1103）创建 **`kind='interactive'` lease**
（`placement.py:504`），与 scan 走同一条 interactive 路径。Wave1 task-06 已在 daemon
`_startInteractiveSession`（session 开始 pull）/`onSessionEnd`（session 终态 sync）为
**所有** interactive lease 接入 tar 模式 spec 同步。因此 **stage 链路（propose/plan/execute）
在 tar 模式下自动复用 Wave1 的 interactive spec-sync，本 task 无需任何 daemon 侧改动**——
只需让 backend prompt 的 `--spec-root` 指向 daemon 本地缓存路径，daemon 写盘后由
`onSessionEnd` 一次性整树 tar 回传 backend。这是 design §5.3 Wave2「自动复用 Wave1 的
interactive spec 同步」的直接体现，也是 D-007@v1 抽共享 utility 的收益兑现。

**不在范围（非目标）**：

- 不改 `dispatch_to_daemon`（行 1103）/`prepare_interactive_dispatch`/`placement.py`
  ——interactive lease 透传 `workspace_id`+`transport` 由 task-03（`build_claim_payload`
  interactive 分支）统一处理，stage 自动复用，不在本 task。
- 不改 daemon 侧 spec 同步（`_startInteractiveSession`/`onSessionEnd`/`spec-sync.ts`）
  ——task-06 已对**所有** interactive lease 生效，stage 路径天然走通，无需额外改动点。
- 不动 scan 链路 `build_scan_bundle`（task-02 范围）。
- 不改 `platform_args` 的拼接格式（仍是 ` --spec-root {x} --runtime-root {y}
  --workspace-id {ws}`），**只改路径值的来源**——从硬编码 f-string 改为 helper 返回值。
- 不展开 tilde（`~`）——展开由 daemon 侧 spawn 环境 HOME 负责（R-01，task-06）。
- 不改 `spec_ws.spec_root`（容器路径权威源）的读取——它仍用于判断 `platform-managed`
  策略，不参与 prompt 路径拼接。

## 2. 覆盖来源

| 类型 | 来源 |
|---|---|
| 需求 | `requirements.md` FR-03（stage 链路 tar prompt 用 daemon 本地路径，复用 scan helper） |
| 决策 | `decisions.md` D-001@v1（transport 正交 strategy，走全局 config 不入库）；D-007@v1（scan/stage 走 interactive，spec 同步在 interactive 路径 + 共享 utility——stage 自动复用 Wave1） |
| 设计 | `design.md` §5.0（核心机制表：stage 同 scan，interactive 路径 × tar 自动 pull/sync）、§5.3（Wave2「stage prompt 分支，自动复用 Wave1 的 interactive spec 同步，无需额外 daemon 改动」）、§6（service.py 行 1006-1023 改动点）、§7.1（helper 契约，由 task-02 实现） |
| 测试契约 | `plan.md` task-11（stage 链路测试：propose/plan/execute 走 interactive，复用 Wave1 spec-sync） |
| 真实代码 | `backend/app/modules/agent/service.py:929-1134`（`start_stage_dispatch`），重点 `1006-1023`（`platform_args` 拼 `host_spec_root`/`host_runtime_root`）+ `1032-1041`（`prompt_context` 渲染 `platform_args`）+ `1103`（`dispatch_to_daemon` → interactive lease） |
| 复用契约 | `tasks/task-02.md` §4.1（`resolve_prompt_spec_root(transport, ws_id, settings) -> str` 签名 + 分支语义 + 非法值回退 shared + tilde 不展开） |

## 3. 修改文件

仅一个文件：`backend/app/modules/agent/service.py`

| 位置 | 改动 |
|---|---|
| 行 1014（`from app.core.config import get_settings`） | 同行追加 import `resolve_prompt_spec_root`：`from app.modules.agent.context_builder import resolve_prompt_spec_root`（与 task-02 helper 落点位一致）。或置于函数顶部 import 区——本 task 沿用行 1014 try-block 内局部 import 的现有风格，避免顶层循环 import 风险（与现有 `from app.modules.spec_workspace.service import SpecWorkspaceService` 同块）。 |
| 行 1017-1018（`host_spec_root`/`host_runtime_root` 拼接） | 改为调 `resolve_prompt_spec_root(settings.spec_transport, str(workspace_id), settings)`；`host_runtime_root` 仍由 `host_spec_root` 派生（`f"{host_spec_root}/runtime"`），与 task-02 build_scan_bundle 派生方式一致。 |
| 行 1019-1023（`platform_args` 拼接） | **格式不变**，只随 `host_spec_root`/`host_runtime_root` 变量自动反映分支值。 |
| 行 1032-1041（`prompt_context`） | **不改**——`platform_args` 作为字符串变量注入 `load_prompt_template`，分支值已在上一步注入。 |

> 注：`settings = get_settings()`（行 1016）调用保留 1 次，helper 接收已构造的 `settings`
> 实例，不重复调用（对齐 task-02 AC-10）。`str(workspace_id)` 显式字符串化（helper 入参
> 类型 `ws_id: str`，与 task-02 调用点 `ws_id = str(workspace_id)` 一致）。

## 4. 接口定义

### 4.1 复用 task-02 helper（不改签名）

task-02 在 `context_builder.py` 新增的 helper（契约见 `tasks/task-02.md` §4.1）：

```python
def resolve_prompt_spec_root(
    transport: str, ws_id: str, settings: Settings
) -> str:
    if transport == "tar":
        return f"~/.sillyhub/daemon/specs/{ws_id}"
    if transport != "shared":
        log.warning("prompt_spec_root_unknown_transport_fallback_shared", transport=transport)
    return f"{settings.spec_data_host_dir}/{ws_id}"
```

本 task **不重新定义、不修改** helper，仅从 `service.py` 调用它。helper 的 shared/tar/
非法值三分支语义、tilde 不展开、`Settings` 类型注解、`log.warning` 兜底均由 task-02 落地
并由 task-08 测试守护。本 task 的职责仅是把 service.py 的硬编码 f-string 改为 helper 调用。

### 4.2 service.py 改动（行 1014-1023 替换）

**改动前**（行 1014-1023）：

```python
from app.core.config import get_settings

settings = get_settings()
host_spec_root = f"{settings.spec_data_host_dir}/{workspace_id}"
host_runtime_root = f"{host_spec_root}/runtime"
platform_args = (
    f" --spec-root {host_spec_root}"
    f" --runtime-root {host_runtime_root}"
    f" --workspace-id {workspace_id}"
)
```

**改动后**：

```python
from app.core.config import get_settings
from app.modules.agent.context_builder import resolve_prompt_spec_root

settings = get_settings()
# 按 transport 分支决定塞入 stage prompt 的 --spec-root 路径（design §5.0 表）。
# 与 build_scan_bundle（context_builder.build_scan_bundle）复用同一 helper，保证
# scan 与 stage 链路在 tar 模式下路径一致（task-02）。
# 注意：host_spec_root 仅用于 prompt 文本（daemon 机器跑 sillyspec 时访问的路径）；
# spec_ws.spec_root（容器路径权威源）的读取不受影响，仅用于 platform-managed 策略判断。
# stage 经 dispatch_to_daemon → interactive lease，tar 模式下 daemon _startInteractiveSession
# pull + onSessionEnd sync 自动复用 Wave1（task-06），本处无需任何 daemon 改动（D-007）。
host_spec_root = resolve_prompt_spec_root(
    settings.spec_transport, str(workspace_id), settings
)
host_runtime_root = f"{host_spec_root}/runtime"
platform_args = (
    f" --spec-root {host_spec_root}"
    f" --runtime-root {host_runtime_root}"
    f" --workspace-id {workspace_id}"
)
```

**`platform_args` 拼接格式逐字符不变**（仍是 ` --spec-root {x} --runtime-root {y}
--workspace-id {ws}`，前导空格、字段顺序、`--workspace-id` 均不变），仅 `{x}`/`{y}` 的
取值从硬编码宿主路径改为 helper 分支返回值。

### 4.3 interactive spec-sync 自动复用（X-001 连带收益，无代码改动）

`start_stage_dispatch` 行 1103 `placement.dispatch_to_daemon(...)` 创建 `kind='interactive'`
lease（`placement.py:504`，与 scan 的 `prepare_scan_interactive_dispatch` 同 kind）。daemon
对 interactive lease 走 `_startInteractiveSession`（`daemon.ts:1711`），Wave1 task-06 已在此
处为 **所有** interactive lease 接入：

- **session 开始**：`_startInteractiveSession` 读 `execPayload.transport === 'tar'` → 调
  `pullSpecBundle(client, wsId)` 拉 backend spec bundle 解到 `~/.sillyhub/daemon/specs/{ws}`
  （缓存，供 propose/plan 读 design 等）。
- **session 终态**：`onSessionEnd`（`daemon.ts:1164`）tar 模式 → 调
  `postSpecSync(client, wsId, resolveSpecDir(wsId))` 整树 tar 回传 backend（一次性，D-004）。

`wsId` 来自 `build_claim_payload` interactive 分支透传的 `workspaceId`（task-03）。
**stage lease 与 scan lease 走同一条 interactive 通道，task-06 的 pull/sync 对 stage 自动
生效**——本 task 不需要在 daemon 侧加任何 stage 专属分支，这是 design §5.3 Wave2「自动
复用 Wave1 的 interactive spec 同步」的直接兑现，也是 D-007@v1 抽共享 utility 的核心收益。

backend 侧唯一要做的，就是让 prompt 的 `--spec-root` 指向 daemon 本地缓存路径（本 task
的 §4.2 改动），这样 daemon 上跑的 `sillyspec run propose/plan/execute` 把文档写进
`~/.sillyhub/daemon/specs/{ws}/.sillyspec/changes/...`，session 结束时 `onSessionEnd`
打 tar 回传，backend `apply_sync` 解到权威源 `/data/{ws}` + reparse。

## 5. 边界处理

| # | 场景 | 处理 |
|---|---|---|
| B-01 | **shared 分支零改动（D-004 核心）** | helper shared 分支返回 `f"{settings.spec_data_host_dir}/{ws_id}"`，与改动前行 1017 字面量 `f"{settings.spec_data_host_dir}/{workspace_id}"` **逐字符一致**（`str(workspace_id)` 与 f-string `{workspace_id}` 对 UUID 的字符串化结果相同）。`SPEC_TRANSPORT` 未配置（task-01 默认 shared）时拼出的 `platform_args` 与现状逐字符相同，现有同机 bind mount 部署零影响。验收 AC-01/AC-02 用「`platform_args` 字符串 diff 为空」守护。 |
| B-02 | **tar 路径与 scan（build_scan_bundle）一致** | service.py 与 context_builder.py **调用同一个 helper**、传同一个 `settings.spec_transport` 和 `str(workspace_id)`，保证 stage 与 scan 在 tar 模式下 `--spec-root` 路径完全一致（都是 `~/.sillyhub/daemon/specs/{ws}`）。daemon pull 缓存目录与 stage 写盘目录一致，propose 写的文档 plan 能读到、plan 写的 design execute 能读到（daemon 本地缓存贯通全 stage 链）。验收 AC-03。 |
| B-03 | **stage 经 interactive 自动复用 Wave1 spec-sync，无需改 daemon（D-007 连带收益）** | `dispatch_to_daemon` 创建 `kind='interactive'` lease（`placement.py:504`），task-06 在 `_startInteractiveSession`/`onSessionEnd` 的 pull/sync 对**所有** interactive lease 生效，stage 天然走通。本 task 严禁在 daemon 侧加 stage 专属分支（违反 D-007 抽共享 utility 的初衷）。验收 AC-04：grep `daemon.ts`/`spec-sync.ts` 确认本 task 零 daemon 改动。 |
| B-04 | **transport 非法值（非 shared/tar）回退 shared** | helper 作为防御性兜底（task-02 §4.1 + B-05）：传入非 `'shared'`/`'tar'` 时走 shared 分支 + `log.warning`，不抛异常。本 task 不重复兜底逻辑（单一真源在 helper），service.py 直接传 `settings.spec_transport`，由 task-01 `field_validator` 在 Settings 层规范化 + helper 兜底。验收 AC-05。 |
| B-05 | **`host_runtime_root` 派生自 `host_spec_root`** | `host_runtime_root = f"{host_spec_root}/runtime"`，自动跟随分支（shared → 宿主路径 `/runtime`，tar → `~/.sillyhub/daemon/specs/{ws}/runtime`）。与 task-02 build_scan_bundle 行 469 派生方式**逐字符一致**，runtime 目录是 spec_root 子目录的 sillyspec 语义不变。验收 AC-03 含 runtime 断言。 |
| B-06 | **`platform_args` 拼接格式不变（仅路径值分支）** | 行 1019-1023 的 f-string 结构（前导空格、`--spec-root`/`--runtime-root`/`--workspace-id` 三段、字段顺序）**逐字符保留**。改动仅是 `{host_spec_root}`/`{host_runtime_root}` 变量的取值来源从硬编码 f-string 改为 helper 返回。验收 AC-06：git diff 行 1019-1023 为空或仅注释变化。 |
| B-07 | **`spec_ws.spec_root`（容器路径权威源）读取不受影响** | 行 1011 `spec_ws.strategy == "platform-managed" and spec_ws.spec_root` 的判断条件**不改**——`spec_root`（容器 `/data/{ws}`）仍用于判断是否注入 platform_args，不参与 prompt 路径拼接。tar 模式下 backend 权威源仍由 `apply_sync` 解 tar 写入 `spec_ws.spec_root`（task-07 复用），与本 task 的 prompt 路径分支正交。验收 AC-07。 |
| B-08 | **try-block 异常兜底保留** | 行 1024 `except Exception` 保留——helper 调用若意外抛异常（如 task-01 未落地 `settings.spec_transport` 不存在 → AttributeError），仍走 `stage_dispatch_platform_args_resolve_failed` warn + `platform_args=""` 回退（stage 命令不带平台参数，退化为基础 sillyspec 行为）。这层兜底在 task-02 未合并时保护 stage 不崩。验收 AC-08。 |

## 6. 非目标（明确不做）

- **不改 `dispatch_to_daemon` / `prepare_interactive_dispatch` / `placement.py`**——interactive
  lease 透传 `workspace_id`+`transport` 由 task-03 在 `build_claim_payload` 统一处理，stage
  自动复用，不在本 task。
- **不改 daemon 侧 `_startInteractiveSession` / `onSessionEnd` / `spec-sync.ts`**——task-06
  已对**所有** interactive lease 生效（D-007），stage 路径天然走通。本 task 严禁在 daemon
  加 stage 专属分支。
- **不碰 `build_scan_bundle`**（task-02 范围）——scan 链路由 task-02 改造，本 task 只复用
  其 helper。
- **不改 `platform_args` 拼接格式**——只改路径值来源（硬编码 f-string → helper 返回）。
- **不展开 tilde**（`~`）——backend 侧无 HOME 语义，展开在 daemon task-06（R-01）。
- **不改 `spec_ws.spec_root` 的读取语义**——容器路径权威源仍用于 platform-managed 策略
  判断，tar 模式下由 apply_sync 写入（task-07）。
- **不新增 transport 入库字段**（D-001）——transport 只从 `settings.spec_transport` 读。
- **不做 transport 切换数据迁移**（D-005）。
- **不写测试**——stage 链路测试属 task-11（`propose/plan/execute` 走 interactive 复用
  Wave1 spec-sync 的端到端守护），本 task 仅定义 task-11 须满足的契约（§8）。

## 7. 参考

- `design.md` §5.0（核心机制表：stage 同 scan，interactive 路径 × tar 自动 pull/sync）
- `design.md` §5.3（Wave2：「stage prompt 分支，自动复用 Wave1 的 interactive spec 同步，
  无需额外 daemon 改动」——本 task 的核心定位）
- `design.md` §6（service.py 行 1006-1023 改动点）
- `design.md` §7.1（helper 契约，task-02 实现）
- `design.md` §7.4（生命周期契约表：pull/post sync/apply_sync 事件链）
- `decisions.md` D-001@v1（transport 正交 strategy，全局 config 不入库）
- `decisions.md` D-007@v1（scan/stage 走 interactive，spec 同步在 interactive 路径 + 共享
  utility——stage 自动复用 Wave1）
- `tasks/task-02.md` §4.1（helper 签名 + 分支语义 + 兜底——本 task 复用契约）
- `requirements.md` FR-03（stage tar prompt 用 daemon 本地路径，复用 scan helper）
- `plan.md` task-11（stage 链路测试契约，本 task 定义）
- 真实代码 `backend/app/modules/agent/service.py:929-1134`（`start_stage_dispatch`）、
  `:1006-1023`（`platform_args` 拼接消费点）、`:1032-1041`（`prompt_context` 渲染）、
  `:1103`（`dispatch_to_daemon` → interactive lease，X-001 连带收益落点）

## 8. TDD（测试由 task-11 落地，本 task 仅定义契约）

本 task **不写测试**（stage 链路测试属 task-11 范围）。本 task 定义 task-11 须满足的契约：

| 测试用例（task-11 实现） | 断言 |
|---|---|
| `test_start_stage_dispatch_platform_args_shared_host_path` | `settings.spec_transport="shared"` 且 `spec_ws.strategy="platform-managed"` 时，渲染后 prompt 含 `f"--spec-root {spec_data_host_dir}/{workspace_id}"`，`--runtime-root` 含 `f"{spec_data_host_dir}/{workspace_id}/runtime"`，与改动前逐字符一致（D-004） |
| `test_start_stage_dispatch_platform_args_tar_daemon_local_path` | `settings.spec_transport="tar"` 时，渲染后 prompt 含 `--spec-root ~/.sillyhub/daemon/specs/{ws}`，`--runtime-root` 含 `~/.sillyhub/daemon/specs/{ws}/runtime`，**不含**宿主路径 `spec_data_host_dir`；tilde 未展开（字面量 `~`） |
| `test_start_stage_dispatch_platform_args_format_unchanged` | `platform_args` 字符串结构（前导空格 + `--spec-root` + `--runtime-root` + `--workspace-id` 三段顺序）在 shared/tar 两模式下逐字符一致，仅路径值不同（AC-06 守护） |
| `test_start_stage_dispatch_platform_args_unknown_fallback_shared` | `settings.spec_transport="bogus"` 时，helper 回退 shared 分支（由 task-02 测试覆盖 helper 本身，本测试守护 service.py 调用点不崩 + warn 日志） |
| `test_start_stage_dispatch_non_platform_managed_no_platform_args` | `spec_ws.strategy != "platform-managed"`（如 repo-native）时 `platform_args=""`，prompt 不含 `--spec-root`（行为不变，与 transport 无关） |
| `test_start_stage_dispatch_tar_reuses_wave1_interactive_sync`（集成/契约守护） | stage 经 `dispatch_to_daemon` 创建 `kind='interactive'` lease（断言 lease metadata/placement kind），tar 模式下 daemon 侧 pull/sync 由 task-06 的 interactive 接入自动触发——本测试守护「stage 自动复用 Wave1，无需 stage 专属 daemon 分支」（AC-04 契约） |

> 实现顺序（CLAUDE.md 执行顺序）：确认 task-01（`settings.spec_transport` 可读）+ task-02
> （`resolve_prompt_spec_root` helper 已落地 `context_builder.py`）已合并 → 读
> `service.py:1006-1023` 现状 → 改行 1014 import + 行 1017-1018 调 helper → 跑 task-11
> 测试 → mypy + ruff。

## 9. 验收标准（每条可点击验证）

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `cd backend && uv run pytest backend/tests/ -k "stage_dispatch and shared"`（task-11 测试） | shared 模式渲染后 prompt 含 `f"--spec-root {spec_data_host_dir}/{workspace_id}"`，**与改动前逐字符一致**（D-004 向后兼容，零回归） |
| AC-02 | git diff `service.py` 仅命中「行 1014 import 追加 + 行 1017-1018 改调 helper」，**行 1019-1023 `platform_args` 拼接格式 + 行 1011 策略判断 + 行 1032-1041 prompt_context 均无改动** | shared 分支行为完全不变（D-004），拼接格式零变化 |
| AC-03 | `cd backend && uv run pytest backend/tests/ -k "stage_dispatch and tar"` | tar 模式渲染后 prompt `--spec-root` 值 == `~/.sillyhub/daemon/specs/{ws}`，`--runtime-root` == `~/.sillyhub/daemon/specs/{ws}/runtime`，tilde 未展开；且与 `build_scan_bundle` tar 分支路径**逐字符一致**（task-02 helper 单源） |
| AC-04 | grep 本 task 的 git diff 范围：`git diff main -- sillyhub-daemon/` 为空 | stage 经 interactive 自动复用 Wave1 spec-sync（D-007），**本 task 零 daemon 侧改动**——daemon pull/sync 对所有 interactive lease 生效，stage 天然走通 |
| AC-05 | `cd backend && uv run pytest backend/tests/ -k "stage_dispatch and unknown_fallback"` | `settings.spec_transport="bogus"` → helper 回退 shared 分支 + log warn（由 task-02 helper 处理），service.py 调用点不抛异常，prompt 含宿主路径 |
| AC-06 | 断言 `platform_args` 字符串结构：shared 与 tar 两模式下，去除路径值后剩余骨架 ` --spec-root  --runtime-root  --workspace-id ` 逐字符一致 | 拼接格式不变，仅路径值分支（B-06） |
| AC-07 | `cd backend && uv run pytest backend/tests/ -k "stage_dispatch and non_platform"` | `spec_ws.strategy != "platform-managed"` 时 `platform_args=""`，`spec_ws.spec_root` 读取仅用于策略判断，不参与 prompt 路径（B-07） |
| AC-08 | `cd backend && uv run pytest backend/tests/ -k "stage_dispatch and resolve_failed"` | helper 调用抛异常时（如 task-01 未落地），try-block 兜底 `platform_args=""` + warn，stage 不崩（B-08） |
| AC-09 | `cd backend && uv run pytest`（全量） | 全部通过，无现有测试回归（含 task-08/09/11 测试） |
| AC-10 | `cd backend && uv run mypy app` + `uv run ruff check .` | 0 error（含 helper import + 调用类型注解 `settings.spec_transport: str`、`str(workspace_id): str`） |
| AC-11 | grep `spec_data_host_dir` in `service.py` | 命中点从改动前的 1 处（行 1017 硬编码）降为 0 处直接消费（改为 helper 调用）；plan.md 调用点搜索记录的 2 个消费点（context_builder.py:468 task-02 + service.py:1017 本 task）全部纳入 helper 替换 |

## 10. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 改动行 1017-1018 时误伤 `platform_args` 拼接格式或 `spec_ws.spec_root` 判断 | 破坏 stage dispatch 现有行为，shared 回归 | AC-02 + AC-06 守护；git diff 严格限定 import 追加 + 行 1017-1018 替换两处 |
| tar 模式 tilde 在 backend 侧被误展开 | prompt 里出现 backend HOME 路径，daemon 跑 sillyspec 写错位置 | helper 不调 `expanduser`（task-02 B-02）；测试 AC-03 断言字面量 `~` |
| task-01 / task-02 未先落地（`settings.spec_transport` 或 helper 不存在） | helper 调用 `AttributeError`/`ImportError` | depends_on: task-02（传递依赖 task-01）；实现前确认 `config.py` 有 `spec_transport` 字段、`context_builder.py` 有 `resolve_prompt_spec_root` 函数 |
| `from app.modules.agent.context_builder import resolve_prompt_spec_root` 引入循环 import | ImportError 启动失败 | 沿用行 1014 try-block 内局部 import 现有风格（与 `SpecWorkspaceService` 同块），避免顶层循环；若 mypy 报循环，移到函数顶部或用 `TYPE_CHECKING` |
| 误以为 stage 需要独立 daemon 改动（违反 D-007） | 在 daemon 加 stage 专属 pull/sync 分支，破坏共享 utility 设计 | AC-04 守护「零 daemon 改动」；明确 B-03 + 非目标：stage 经 interactive 自动复用 Wave1（task-06 对所有 interactive lease 生效） |
| shared 分支字符串拼接与原行 1017 不完全一致 | 隐性回归，同机部署 stage prompt 路径变化 | AC-01 用「逐字符一致」断言；helper shared 分支 return 表达式与原行 1017 右值**完全相同**（`f"{settings.spec_data_host_dir}/{ws_id}"`，`str(workspace_id)` == f-string `{workspace_id}` 对 UUID 的输出） |
| `dispatch_to_daemon` 实际创建的 lease kind 不是 interactive（design §5.0 假设失效） | tar 模式 stage 不走 interactive，task-06 pull/sync 不触发，文档不回传 | design §13 X-001 已核实 `placement.py:504` stage 走 `kind='interactive'`；实现时 task-11 的 `test_start_stage_dispatch_tar_reuses_wave1_interactive_sync` 守护 lease kind 断言 |

## 11. 完成定义（DoD）

- [ ] 11 个 AC 全部通过（含 shared 零回归 AC-01/AC-02 + tar AC-03 + 零 daemon 改动 AC-04）
- [ ] `cd backend && uv run pytest` 全量通过（含 task-11 新增 stage 链路测试）
- [ ] `cd backend && uv run mypy app` + `uv run ruff check .` 通过
- [ ] git diff 仅命中 `service.py`，改动范围 = 行 1014 import 追加 + 行 1017-1018 改调 helper
- [ ] git diff `sillyhub-daemon/` 为空（stage 自动复用 Wave1 interactive spec-sync，D-007）
- [ ] D-001（transport 走 config 不入库）、D-007（stage 走 interactive 自动复用共享 utility）
      两项决策在验收中显式验证通过（AC-04 + AC-11）
- [ ] unblock task-11（stage 链路测试）
