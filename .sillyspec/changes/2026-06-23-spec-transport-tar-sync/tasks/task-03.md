---
id: task-03
title: build_claim_payload interactive 分支 tar 模式透传 workspace_id+transport、不透传 spec_root（覆盖：FR-04, D-007@v1）
priority: P0
estimated_hours: 2
depends_on: [task-01]
blocks: [task-09]
requirement_ids: [FR-04]
decision_ids: [D-007@v1]
allowed_paths:
  - backend/app/modules/daemon/lease/context.py
author: qinyi
created_at: 2026-06-23 11:20:01
---

# task-03：build_claim_payload interactive 分支按 transport 分支透传

## 1. 目标

`build_claim_payload`（`backend/app/modules/daemon/lease/context.py:42-200`）的
**interactive 分支**（行 61-117，scan/stage 走此分支——`prepare_scan_interactive_dispatch` /
`prepare_interactive_dispatch` 均创建 `kind='interactive'` lease）按 `settings.spec_transport`
分两路：

- **shared 模式**（默认）：维持现状，透传 `specRoot`/`spec_root`/`runtimeRoot`/`runtime_root`
  （行 110-116），daemon 走 `translateSpecRoot` 翻译路径，bind mount 共享物理盘。
- **tar 模式**（新增）：
  1. **不透传** `specRoot`/`spec_root`/`runtimeRoot`/`runtime_root`（让 daemon
     `_startInteractiveSession` 走 `pullSpecBundle` 分支，D-007@v1）。
  2. **新增透传 `transport`**（camelCase `transportMode` + snake_case `transport` 双写，
     对齐现有 `specRoot/spec_root`、`rootPath/root_path`、`workspaceName/workspace_name`
     双写惯例）。
  3. **新增透传 `workspaceId`/`workspace_id`**（daemon `pullSpecBundle` 需 wsId 调
     `getSpecBundle(workspace_id)`，当前 interactive 分支未透传——design §13 X-004 gap）。

**纯 additive 改动**：payload 是 dict，tar 模式新增 key、shared 模式保留原 key，两路都不删
既有 key。运行时唯一调用点 `lease/service.py:196`（claim 流程）原样消费 payload dict，
**无需改动**；daemon 侧 `_startInteractiveSession` 读 `execPayload.transport === 'tar'`
（task-06），shared 模式 daemon 读不到 `transport` 字段走原逻辑（向后兼容，D-004@v1）。

## 2. 修改文件

| 操作 | 文件 | 位置 | 说明 |
|---|---|---|---|
| 修改 | `backend/app/modules/daemon/lease/context.py` | interactive 分支行 89-117（spec_root 解析+透传块） | 包一层 `transport` 判断：tar 模式跳过 spec_root 透传、改透传 transport + workspace_id；shared 模式原样 |

**不改**：batch 分支（行 119-200）、文件头部 import（除非需新增 `get_settings`）、
`_raise_no_agent_run`、函数签名、docstring 主体（仅在 interactive 分支补注释说明 transport 分支）。

## 3. 覆盖来源

| 来源 | 章节/行号 | 对应本任务 |
|---|---|---|
| design.md §5.0 | 开关点 1（透传字段表：tar 透传 workspace_id+transport，不带 spec_root） | §1 目标、§4 接口定义 |
| design.md §7.2 | build_claim_payload interactive 分支改动伪代码（`transport = get_settings().spec_transport` + 双写 + `if transport == "tar" and ws_id`） | §4 接口定义逐字对齐 |
| design.md §7.4 | 生命周期契约表「build_claim_payload（tar 模式）」行：必需字段 `+ transport/transportMode + workspaceId（不带 specRoot）` | §6 验收 AC-02 |
| design.md §13 X-004 | build_claim_payload interactive 分支未透传 workspace_id（gap） | §1 目标 3、§5 边界 E3 |
| decisions.md D-007@v1 | scan/stage 走 interactive，spec 同步在 interactive 路径；`build_claim_payload` interactive 分支 tar 模式透传 `workspace_id` | 全任务基线 |
| decisions.md D-003@v1 | tar 模式 `build_claim_payload` 不透传 spec_root → daemon existingSpecRoot 空 → pull 触发 | §1 目标 1 |
| decisions.md D-004@v1 | shared 模式 build_claim_payload 仍透传 spec_root | §1 shared 分支、§5 边界 E1 |
| plan.md task-03 行 | tar 不透传 spec_root、透传 workspace_id+transport | 任务范围 |
| plan.md 调用点搜索 | `build_claim_payload` 唯一运行时调用点 `lease/service.py:196`，task-03 additive、调用点无需改 | §1 additive 说明 |

## 4. 接口定义

### 4.1 import 改动

文件顶部 import 区（行 10-21）新增 `get_settings`（task-01 已在 `app.core.config` 暴露
`spec_transport` 字段，复用现有 `get_settings` 入口；与 `agent/service.py:1017` 等同款调用）：

```python
from app.core.config import get_settings
```

> 若 `app.core.config` 未导出 `get_settings`（task-01 决定入口名），以 task-01 实际暴露
> 的入口为准（如 `from app.core.config import Settings, get_settings`）。本任务不负责
> 定义 `get_settings`，仅消费 task-01 产出的 `settings.spec_transport`。

### 4.2 interactive 分支改动伪代码（对齐 design §7.2）

在现有 interactive 分支的 **spec_root 解析块之前**（即行 89 `spec_root: str | None = ...`
之前）插入 transport 读取；在 **spec_root 透传块**（行 110-116）外层包 transport 分支。
完整改动后 interactive 分支尾部形态：

```python
# ===== task-03（2026-06-23-spec-transport-tar-sync）：transport 分支 =====
# D-007@v1：scan/stage 走 interactive lease，tar 模式 spec 同步在 interactive 路径
# （daemon _startInteractiveSession pull + onSessionEnd sync）。backend 侧开关点：
#   - tar：不透传 spec_root（让 daemon pull 触发）+ 透传 workspace_id（pull 需 wsId）
#         + 透传 transport（daemon 读 execPayload.transport === 'tar' 切分支）。
#   - shared（默认）：维持现状透传 spec_root/runtime_root，daemon 走 translateSpecRoot，
#         bind mount 共享，不 pull 不 sync（D-004@v1 向后兼容）。
transport = get_settings().spec_transport
# transport 双写（camelCase + snake_case），对齐 specRoot/spec_root、rootPath/root_path
# 惯例；daemon execPayload 归一化两端字段名都覆盖。
payload["transport"] = transport
payload["transportMode"] = transport

# ws_id 解析：来源 lease_meta.workspace_id（prepare_scan_interactive_dispatch 写入，
# placement.py:494）→ 兜底查 SpecWorkspace（与现有 spec_root 解析同款 DB 回填）。
# 注意：普通 prepare_interactive_dispatch（quick-chat）不写 workspace_id → ws_id=None
# → tar 模式也不透传 workspaceId（quick-chat 无 spec 同步语义，向后兼容）。
ws_id_raw = lease_meta.get("workspace_id")
ws_id: uuid.UUID | None = None
if ws_id_raw:
    try:
        ws_id = uuid.UUID(ws_id_raw) if isinstance(ws_id_raw, str) else ws_id_raw
    except (ValueError, AttributeError, TypeError):
        ws_id = None

if transport == "tar":
    # tar 模式：不透传 specRoot/spec_root/runtimeRoot/runtime_root（daemon pull 分支）。
    if ws_id is not None:
        payload["workspaceId"] = str(ws_id)   # daemon pullSpecBundle 需 wsId
        payload["workspace_id"] = str(ws_id)  # snake_case 双写
    # 不 set specRoot/spec_root → daemon execPayload.specRoot 为 undefined
    # → _startInteractiveSession 走 pullSpecBundle（D-003@v1）
    return payload

# ===== shared 模式（默认，D-004@v1 现状零改动）=====
# 以下为现有行 89-116 的 spec_root 解析 + 透传逻辑，逐字保留。
spec_root: str | None = lease_meta.get("spec_root")
if not spec_root:
    if ws_id is not None:  # 复用上方已解析的 ws_id（原代码在此块内重复解析，可合并）
        from app.modules.spec_workspace.model import SpecWorkspace

        ws_stmt = select(SpecWorkspace).where(col(SpecWorkspace.workspace_id) == ws_id)
        spec_ws = (await session.execute(ws_stmt)).scalars().first()
        if spec_ws is not None:
            spec_root = spec_ws.spec_root
if spec_root:
    payload["specRoot"] = spec_root
    payload["spec_root"] = spec_root
    runtime_root = lease_meta.get("runtime_root")
    if runtime_root:
        payload["runtimeRoot"] = runtime_root
        payload["runtime_root"] = runtime_root
return payload
```

### 4.3 重构说明（ws_id 解析上提）

现有代码在 spec_root 解析块**内部**（行 91-98）解析 ws_id，仅在 `not spec_root` 时触发。
本任务把 ws_id 解析**上提到 transport 分支之前**，让 tar 模式与 shared 模式共用同一份
ws_id（避免重复解析；tar 模式 ws_id 直接用于透传 workspaceId，shared 模式 ws_id 用于
DB 回填 spec_root）。**行为等价**：shared 模式下 ws_id 解析时机提前但结果不变（同
lease_meta、同 UUID 解析逻辑），原 `if not spec_root` 块内的重复解析合并为复用上提变量。

> 若评估认为上提重构超范围（risk 风险），可保守方案：tar 分支内独立再解析一次 ws_id
> （复制 91-98 行逻辑），shared 分支原样不动。两种方案任选其一，AC 不强制。**推荐上提**
> （代码更整洁，行为等价）。

### 4.4 payload dict 新增 key 契约

| 模式 | 新增/保留 key | 类型 | 来源 | daemon 消费点 |
|---|---|---|---|---|
| shared + tar | `transport`（新增，两模式都写） | `str`（"shared"/"tar"） | `get_settings().spec_transport` | task-06 `_startInteractiveSession` 读 `execPayload.transport` |
| shared + tar | `transportMode`（新增，两模式都写） | `str` | 同上（camelCase 双写） | task-06 daemon execPayload 归一化 |
| tar only | `workspaceId`（新增） | `str(uuid)` | `lease_meta.workspace_id` 解析 | task-06 `pullSpecBundle(client, wsId)` 入参 |
| tar only | `workspace_id`（新增） | `str(uuid)` | 同上（snake_case 双写） | task-06 daemon execPayload 归一化 |
| shared only | `specRoot`/`spec_root`（保留现状） | `str` | 现有逻辑不变 | 现有 daemon `translateSpecRoot` |
| shared only | `runtimeRoot`/`runtime_root`（保留现状） | `str \| None` | 现有逻辑不变 | 现有 daemon 路径翻译 |
| tar only | （**不写**）`specRoot`/`spec_root` | — | 故意缺省 | task-06 daemon 走 pullSpecBundle |

## 5. 边界处理 / Edge Cases

| 编号 | 边界场景 | 处理 | 依据 |
|---|---|---|---|
| E1 | **shared 模式零改动** | transport=shared 时走原 spec_root 透传逻辑（行 89-116 逐字保留），payload 含 specRoot/spec_root，不含 workspaceId（除非未来扩展）。daemon 读不到 transport 字段或 transport=shared 走原 translateSpecRoot 路径 | D-004@v1、design §5.1 |
| E2 | **tar 模式不透传 spec_root** | tar 分支显式不 set specRoot/spec_root/runtimeRoot/runtime_root，即使 lease_meta.spec_root 存在也不透传（让 daemon pull 触发）。**不删除** payload 中其他既有 key（lease_id/kind/prompt 等） | D-003@v1、design §7.2 |
| E3 | **ws_id 来源：lease_meta.workspace_id（主）** | `prepare_scan_interactive_dispatch` 在 placement.py:494 写入 `metadata.workspace_id=str(workspace_id)`，task-03 优先读此字段。UUID 解析失败（str malformed）→ ws_id=None → tar 模式不透传 workspaceId（降级，记 warn 可选） | design §13 X-004、placement.py:494 |
| E4 | **ws_id 缺失（quick-chat 场景）** | 普通 `prepare_interactive_dispatch`（quick-chat）不写 workspace_id 到 metadata → ws_id=None。tar 模式下 payload 不含 workspaceId/transport 相关 spec 同步字段，但**仍写 transport/transportMode**（daemon 读到 transport=tar 但无 wsId → 跳过 pull，仅 warn）。quick-chat 无 spec 语义，向后兼容 | context.py:87 现有注释、D-007@v1 |
| E5 | **transport 双写一致性** | `transport` 与 `transportMode` 必须同值同源（都来自 `get_settings().spec_transport`），不可一个写 hardcode 一个读 config。daemon 侧字段名归一化两端都覆盖，任一缺失会导致 daemon 分支误判 | design §7.2 双写惯例 |
| E6 | **tar 模式 lease_meta.spec_root 存在** | tar 模式即使 `lease_meta.get("spec_root")` 有值（prepare_scan_interactive_dispatch 在 placement.py:485 写入），也**不透传**——backend 容器路径对 daemon 异机无意义，daemon 必须走 pull 拉本地缓存路径。这是 tar 模式核心语义 | D-003@v1 normalized_requirement |
| E7 | **get_settings 调用频次** | `get_settings()` 是 lru_cache 单例（pydantic-settings 标准模式），每次 claim 调用一次开销可忽略。不在函数顶部缓存到局部变量也行（transport 单次读取） | 现有 `agent/service.py:1017` 同款 |
| E8 | **additive 不破坏既有测试** | 现有 `test_lease_service.py` AC-01/02/03（行 876/877 附近）测 shared 模式 spec_root 透传，本任务 shared 分支零改动 → 这些测试继续通过。tar 模式新测试在 task-09 | plan task-09、test_lease_service.py:876 |

## 6. 非目标

- **不改 batch 分支**（context.py 行 119-200）：batch lease 走 task-runner，spec 同步由
  task-05 改调 spec-sync utility，与 build_claim_payload 透传字段无关（batch 分支已透传
  `workspace_id` 行 146）。
- **不新增 transport 到 batch 分支**：batch 路径 spec 同步决策在 task-runner 内
  （task-05），不在 payload 层。本任务仅改 interactive 分支。
- **不定义 `get_settings`/`spec_transport` 字段**：那是 task-01 职责，本任务消费。
- **不改 lease/service.py:196 调用点**：payload dict additive，调用点原样透传。
- **不改 daemon 侧**：daemon 读 transport/workspaceId 的逻辑是 task-06。
- **不做 ws_id 的 SpecWorkspace DB 回填 for tar 模式**：tar 模式 ws_id 仅从 lease_meta 取
  （scan/stage dispatch 都写 lease_meta.workspace_id）；若 lease_meta 无 ws_id 视为
  quick-chat 场景跳过（E4），不查 DB 兜底（DB 兜底是 shared 模式 spec_root 回填的伴生逻辑）。
- **不处理 lease_meta.transport 覆盖**：transport 全局决策（D-002@v1），不从 lease metadata
  读 transport 覆盖全局 config（避免 per-lease transport 与全局不一致）。

## 7. 参考

- **现有双写模式参考**：context.py:111-112（`specRoot`/`spec_root`）、:189-191
  （`rootPath`/`root_path`）、:183-185（`workspaceName`/`workspace_name`）——本任务
  `transport`/`transportMode`、`workspaceId`/`workspace_id` 双写完全对齐此模式。
- **现有 ws_id 解析参考**：context.py:91-98（UUID 解析 + try/except）——本任务上提复用。
- **现有 SpecWorkspace 查询参考**：context.py:105-106（`select(SpecWorkspace).where(
  col(SpecWorkspace.workspace_id) == ws_id)`）——shared 分支 DB 回填保留此模式。
- **design §7.2 伪代码**：本任务实现逐字对齐 design §7.2 的 Python 伪代码块。
- **task-01 config 字段**：`Settings.spec_transport`（读 `SPEC_TRANSPORT` env，默认 shared，
  枚举校验 + field_validator 规范化），本任务 `get_settings().spec_transport` 消费。
- **task-06 daemon 消费**：`_startInteractiveSession` 读 `execPayload.transport === 'tar'`
  + `execPayload.workspaceId` 调 `pullSpecBundle(client, wsId)`。

## 8. TDD（测试驱动顺序）

> 本任务仅改 context.py；测试代码在 **task-09**（`backend/tests/modules/daemon/`）。
> 本任务实现时先手写测试断言（临时脚本或 task-09 测试骨架）验证，正式测试归档到 task-09。

1. **RED**：写断言「tar 模式 payload 不含 specRoot、含 transport/transportMode/workspaceId/
   workspace_id」→ 当前代码失败（无 transport 分支）。
2. **GREEN**：按 §4.2 伪代码实现 transport 分支 → 断言通过。
3. **REFACTOR**：ws_id 解析上提（§4.3），shared 模式现有测试（test_lease_service.py AC-01/02/03）
   继续通过。

**手测骨架**（实现时自测，正式版归 task-09）：

```python
# 伪代码，实际在 task-09 落地为 pytest 用例
async def test_build_claim_payload_tar_mode():
    settings.spec_transport = "tar"
    lease = make_interactive_lease(metadata={"workspace_id": str(ws_uuid), "spec_root": "/data/ws"})
    payload = await build_claim_payload(session, lease)
    assert payload["transport"] == "tar"
    assert payload["transportMode"] == "tar"
    assert payload["workspaceId"] == str(ws_uuid)
    assert payload["workspace_id"] == str(ws_uuid)
    assert "specRoot" not in payload       # tar 不透传
    assert "spec_root" not in payload
    assert "runtimeRoot" not in payload

async def test_build_claim_payload_shared_mode_unchanged():
    settings.spec_transport = "shared"  # 默认
    lease = make_interactive_lease(metadata={"spec_root": "/data/ws", "workspace_id": str(ws_uuid)})
    payload = await build_claim_payload(session, lease)
    assert payload["specRoot"] == "/data/ws"   # 现状保留
    assert payload["spec_root"] == "/data/ws"
    assert payload["transport"] == "shared"     # 新增但不影响 daemon 分支
    # shared 模式不透传 workspaceId（仅在 tar 模式透传）
    assert "workspaceId" not in payload

async def test_build_claim_payload_tar_no_workspace_id_quick_chat():
    settings.spec_transport = "tar"
    lease = make_interactive_lease(metadata={})  # quick-chat 无 workspace_id
    payload = await build_claim_payload(session, lease)
    assert payload["transport"] == "tar"
    assert "workspaceId" not in payload   # ws_id 缺失不透传
    assert "specRoot" not in payload      # tar 仍不透传 spec_root
```

## 9. 验收标准（AC）

| AC | 验收点 | 验证方法 | 覆盖 |
|---|---|---|---|
| AC-01 | shared 模式（默认）payload 含 `specRoot`/`spec_root`，透传逻辑与改动前逐字一致（行 89-116 保留） | task-09 测试 + 现有 test_lease_service.py AC-01/02/03 通过 | D-004@v1、SC-1 |
| AC-02 | tar 模式 payload 含 `transport="tar"` + `transportMode="tar"` + `workspaceId`/`workspace_id`（ws_id 存在时），**不含** `specRoot`/`spec_root`/`runtimeRoot`/`runtime_root` | task-09 测试 `test_build_claim_payload_tar_mode` | FR-04、D-007@v1、design §7.4 |
| AC-03 | tar 模式 ws_id 缺失（quick-chat）→ payload 含 transport 但不含 workspaceId，仍不含 specRoot（tar 语义不因 ws_id 缺失回退 shared） | task-09 测试 `test_build_claim_payload_tar_no_workspace_id_quick_chat` | design §13 X-004、边界 E4 |
| AC-04 | `transport` 与 `transportMode` 同值同源（都来自 `get_settings().spec_transport`） | task-09 断言两者相等 | 边界 E5 |
| AC-05 | transport 全局决策，不从 lease_meta 读 transport 覆盖 | code review（无 `lease_meta.get("transport")`） | D-002@v1、非目标 |
| AC-06 | batch 分支（行 119-200）零改动 | git diff 仅在 interactive 分支（行 61-117 区域） | 非目标 |
| AC-07 | lease/service.py:196 调用点零改动（payload dict additive） | git diff 不含 lease/service.py | plan 调用点搜索 |
| AC-08 | `cd backend && uv run pytest backend/tests/modules/daemon/` 全通过（含现有 test_lease_service.py shared 模式用例） | 本地跑 pytest | SC-1 |
| AC-09 | `cd backend && uv run mypy backend/app/modules/daemon/lease/context.py` + `uv run ruff check backend/app/modules/daemon/lease/context.py` 通过 | 本地跑 | 全局 AC |
| AC-10 | ws_id 解析上提（§4.3）后 shared 模式现有 test_lease_service.py AC-02（lease_meta 无 spec_root + workspace_id 存在 + SpecWorkspace.spec_root 回填）仍通过 | 跑现有测试 | 重构等价性 |

## 10. 依赖关系

- **depends_on: task-01**：需 `Settings.spec_transport` 字段 + `get_settings` 入口
  （task-01 在 `app/core/config.py` 定义）。task-01 未完成则 `get_settings().spec_transport`
  AttributeError，本任务无法实现。
- **blocks: task-09**：task-09 的 backend claim 透传测试（`test_build_claim_payload_tar_mode`
  等）依赖本任务实现的 transport 分支。
- **不依赖 task-02/04/05/06**：本任务是 backend 侧独立改动点，与 scan prompt helper
  （task-02）、daemon spec-sync（task-04/06）并行。daemon 侧消费 transport/workspaceId
  在 task-06，本任务仅保证 payload 透传正确。

## 11. 风险

| 风险 | 等级 | 应对 |
|---|---|---|
| ws_id 解析上提（§4.3）改变 shared 模式行为 | P2 | 上提仅改解析时机不改结果（同 lease_meta、同 UUID 逻辑）；AC-10 用现有 test_lease_service.py AC-02 守护；若保守可不上提（§4.3 备选方案） |
| `get_settings` 入口名与 task-01 不一致 | P2 | 实现时以 task-01 实际暴露入口为准（本任务写 `get_settings` 占位，task-01 若用别的名同步改） |
| tar 模式 daemon 侧（task-06）尚未实现，本任务 payload 字段无法端到端验证 | P3 | 本任务仅保证 payload 透传正确（AC-02/03/04），端到端在 task-12；task-09 单测验证 payload 字段足够 |
