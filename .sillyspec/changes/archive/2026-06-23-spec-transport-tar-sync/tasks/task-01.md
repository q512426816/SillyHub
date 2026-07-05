---
id: task-01
title: backend config 加 spec_transport 字段（覆盖：FR-01, D-001@v1, D-002@v1）
priority: P0
estimated_hours: 1
depends_on: []
blocks: [task-02, task-03]
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/core/config.py
author: qinyi
created_at: 2026-06-23 11:20:01
---

# task-01

backend `Settings` 新增全局开关字段 `spec_transport`，读环境变量 `SPEC_TRANSPORT`，
默认 `shared`（向后兼容，D-004），枚举 `shared | tar`（D-002），通过 `field_validator`
做小写规范化 + 非法值校验。transport 与 `SpecWorkspace.strategy` 正交，走全局 config，
**不入库**（D-001）。本任务是整个变更的根基，task-02（scan prompt helper）和 task-03
（claim payload 透传）都依赖此字段读出的值做分支。

## 修改文件

仅一个文件：

- `backend/app/core/config.py`（`Settings` 类，`spec_data_host_dir` 字段定义后、`_resolve_spec_data_root`
  validator 之后，与 spec 相关字段集中放置，便于阅读）

## 覆盖来源

| 来源 | 关键条款 | 本任务如何落实 |
|---|---|---|
| design §5.0 | transport 全局开关，shared/tar 两模式 | 新增字段 + 枚举校验 |
| design §6 | config.py 加 `spec_transport` 字段（默认 shared，枚举校验，field_validator 规范化） | 字段定义 |
| design §9 | 未配置 `SPEC_TRANSPORT` 默认 shared，零影响 | default="shared" |
| D-001@v1 | transport 正交 strategy，走全局 config 不入库 | 字段加在 `Settings`，**不碰 `SpecWorkspace` 表** |
| D-002@v1 | 全局 env `SPEC_TRANSPORT=shared\|tar`，默认 shared，field_validator 规范化（小写 + 枚举校验） | `Literal` + `field_validator` |
| FR-01 | backend 提供全局 transport 开关 | 字段即开关 |

## 实现要求

1. 在 `backend/app/core/config.py` 的 `Settings` 类中，紧随 `spec_data_host_dir`
   字段（当前行 74-79）之后、`_resolve_spec_data_root` validator（行 80-86）之后，
   新增 `spec_transport` 字段。位置选择理由：与 `spec_data_root` / `spec_data_host_dir`
   同属 spec 相关配置块，便于阅读，且 validator 集中排列。

2. 字段类型用 `Literal["shared", "tar"]`（项目已在 `environment` 字段用此写法，行 38），
   默认值 `"shared"`。

3. 加一个 `@field_validator("spec_transport", mode="before")` 做规范化：
   - 若为 `str`：`.strip().lower()`，再交给 Pydantic 的 `Literal` 做枚举校验（非法值由
     Pydantic 自动抛 `ValidationError`，消息清晰）。
   - 非 str（含 None）：原样返回，交给 Pydantic 按 `Literal` 校验（None 会被拒，触发
     默认值回退路径见边界 1）。
   - 命名惯例对齐现有 `_resolve_spec_data_root` / `_split_csv`：单下划线前缀 + `cls` +
     `mode="before"`。

4. 字段需有 `description`，说明：transport 模式（shared 同机 bind mount / tar 异机
   backend 独占真理源），读 `SPEC_TRANSPORT` env，默认 shared 向后兼容。可加一行块注释
   说明 D-001（正交 strategy 不入库）+ D-002（全局 env）。

5. **不要** 改 `SpecWorkspace` 模型 / 加表字段 / 写迁移（D-001 明确不入库）。

6. **不要** 改 `get_settings` 或 `model_config`（env 注入由现有 `SettingsConfigDict`
   的 `case_sensitive=False` 自动覆盖 `SPEC_TRANSPORT` → `spec_transport`）。

7. **不要** 在本任务实现 prompt 分支 / claim payload 透传 / helper 函数（那是 task-02 /
   task-03）。本任务只产出 config 字段 + 单测。

## 接口定义

### 字段签名

```python
# backend/app/core/config.py，Settings 类内，spec_data_host_dir 之后

# ── Spec transport (global switch, NOT persisted to DB — D-001@v1) ────────
# D-002@v1: 全局环境变量 SPEC_TRANSPORT=shared|tar，默认 shared 向后兼容同机部署。
# shared: 同机 bind mount，prompt 用宿主路径，不 pull 不回传（D-004 现状）。
# tar:    异机，backend 独占真理源，daemon pull 缓存 + lease 终态整树回传。
spec_transport: Literal["shared", "tar"] = Field(
    default="shared",
    description="Global spec transport mode. 'shared' = same-host bind mount (legacy, "
    "zero-change); 'tar' = cross-host, backend is source of truth with daemon pull+sync. "
    "Read from SPEC_TRANSPORT env. Orthogonal to SpecWorkspace.strategy, NOT persisted (D-001).",
)


@field_validator("spec_transport", mode="before")
@classmethod
def _normalize_spec_transport(cls, raw: object) -> object:
    """Normalize SPEC_TRANSPORT: strip + lower-case before Literal enum check.

    Invalid values (e.g. 'http', 'ftp', 'SHARED ' trailing junk after strip)
    fall through to Pydantic Literal validation which raises a clear
    ValidationError listing allowed values.
    """
    if isinstance(raw, str):
        return raw.strip().lower()
    return raw
```

### 读取方式（下游 task 用，不在本任务实现，仅约定契约）

```python
from app.core.config import get_settings

transport = get_settings().spec_transport   # "shared" | "tar"
if transport == "tar":
    ...
```

### 环境变量映射

| env | 字段 | 类型 | 默认 | 校验 |
|---|---|---|---|---|
| `SPEC_TRANSPORT` | `spec_transport` | `Literal["shared","tar"]` | `"shared"` | strip + lower → Literal 枚举（非法值 ValidationError） |

`case_sensitive=False`（config.py:103）保证 env 名大小写无关，`SPEC_transport` / `spec_transport`
均能注入；validator 进一步把值规范化小写。

## 边界处理

1. **未设 `SPEC_TRANSPORT` env**：走字段 default `"shared"`，不报错，全部下游走 shared 分支
   （D-004 现状零改动）。验证：测试不设 env，断言 `settings.spec_transport == "shared"`。

2. **非法枚举值**（如 `SPEC_TRANSPORT=http` / `ftp` / `local`）：validator 的 strip+lower 后
   交给 Pydantic `Literal` 校验，抛 `ValidationError`（pydantic 消息会列出 `expected: shared|tar`）。
   backend 启动即失败（fail-fast），符合「全局单一开关」语义，避免静默走错模式。验证：测试
   `monkeypatch.setenv("SPEC_TRANSPORT", "http")` + `pytest.raises(ValidationError)`。

3. **大小写 / 前后空格**：`SPEC_TRANSPORT=TAR` / `Tar` / ` shared ` / `SHARED` 经 validator
   strip+lower 全部规范化为 `shared` / `tar`。验证：参数化测试覆盖这四种输入 → 期望值。

4. **空串** `SPEC_TRANSPORT=`：`.strip().lower()` 后是 `""`，`Literal["shared","tar"]` 拒绝
   空串，抛 `ValidationError`（与边界 2 同路径）。注意：pydantic-settings 对空 env 值的处理
   是「视为已设值为空串」而非「视为未设」，因此空串不会回退 default，而是显式报错——这是期望
   行为（用户写了 `SPEC_TRANSPORT=` 多半是配置失误，应尽早暴露）。验证：测试
   `monkeypatch.setenv("SPEC_TRANSPORT", "")` + `pytest.raises(ValidationError)`。

5. **不影响 `spec_data_root` / `spec_data_host_dir`**：新字段独立，不与现有 spec 路径字段
   交互；`_resolve_spec_data_root` validator 仍正常工作。两字段在 shared/tar 两种模式下都
   被使用（shared 用 host_dir 拼 prompt 路径；tar 也仍需 host_dir/root 作为 backend 权威源），
   因此本任务不动它们。验证：测试 `spec_data_root` / `spec_data_host_dir` 默认值在加入新字段
   后不变。

6. **env 注入大小写**：`SPEC_TRANSPORT` / `spec_transport` / `Spec_Transport` 任一写法均能
   注入（靠 `case_sensitive=False`），不会被 validator 干扰（validator 只规范化**值**，不规范化
   **键**）。验证：可选测试 `monkeypatch.setenv("spec_transport", "tar")` 也能注入。

7. **`get_settings` 缓存**：字段加完后 `get_settings()` 仍走 `lru_cache`，进程内单例；测试需
   用 `get_settings.cache_clear()` 或直接构造 `Settings(...)` 避免污染（见 TDD 步骤）。

## 非目标

- 不实现 prompt 分支（task-02 / task-10）
- 不实现 claim payload 透传（task-03）
- 不实现 daemon spec-sync（task-04/05/06）
- 不改 `SpecWorkspace` 表 / 不加迁移（D-001）
- 不做 transport 切换的数据迁移（D-005，CLAUDE.md 规则7）
- 不改 `model_config` / `get_settings`
- 不新增 helper 函数（resolve_prompt_spec_root 是 task-02 的活）

## 参考

- 现有字段写法对齐 `spec_data_host_dir`（config.py:74-79）：`Field(default=..., description=...)`
  + 上方块注释说明设计决策来源。
- 现有 validator 写法对齐 `_resolve_spec_data_root`（config.py:80-86）与 `_split_csv`
  （config.py:106-117）：`@field_validator(..., mode="before")` + `@classmethod` + 单下划线
  前缀方法名 + `raw: object` 入参。
- `Literal` 枚举写法对齐 `environment`（config.py:38）。
- design §6 文件变更清单第 1 行明确要求 config.py 此字段。
- decisions D-001@v1（不入库）、D-002@v1（env + 默认 shared + 规范化）。

## TDD 步骤

遵循 CLAUDE.md「文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收」。

1. **读现有代码**：`backend/app/core/config.py`（已读，Settings 结构 + validator 模式清晰）；
   顺带确认 `backend/tests/` 下是否已有 config 测试文件（若有则追加，若无则新建
   `backend/tests/core/test_config_spec_transport.py`）。

2. **写测试先**（新建 `backend/tests/core/test_config_spec_transport.py`，但注意：测试文件
   不在本任务 `allowed_paths` 内——若 execute agent 严格执行 allowed_paths，则测试由 task-08
   或独立测试任务承接；本任务蓝图列出测试用例供承接方照写。若流程允许 execute agent 顺带写测试，
   按下方用例实现）：

   ```python
   import pytest
   from pydantic import ValidationError
   from app.core.config import Settings, get_settings

   def _make(**overrides):
       """构造 Settings，补齐必填字段避免 ValidationError 噪音。"""
       base = {
           "database_url": "postgresql+asyncpg://u:p@h:5432/d",
           "secret_key": "x" * 16,
       }
       base.update(overrides)
       return Settings(**base)

   class TestSpecTransportDefault:
       def test_default_is_shared(self):
           s = _make()
           assert s.spec_transport == "shared"

       def test_env_not_set_uses_shared(self, monkeypatch):
           monkeypatch.delenv("SPEC_TRANSPORT", raising=False)
           get_settings.cache_clear()
           assert Settings().spec_transport == "shared"

   class TestSpecTransportValid:
       @pytest.mark.parametrize("raw,expected", [
           ("shared", "shared"),
           ("tar", "tar"),
           ("SHARED", "shared"),     # 大写
           ("Tar", "tar"),
           (" shared ", "shared"),   # 前后空格
           ("TAR", "tar"),
       ])
       def test_normalization(self, raw, expected):
           s = _make(spec_transport=raw)
           assert s.spec_transport == expected

   class TestSpecTransportInvalid:
       @pytest.mark.parametrize("bad", ["http", "ftp", "local", "shard", "tar1", "x"])
       def test_invalid_enum_raises(self, bad):
           with pytest.raises(ValidationError):
               _make(spec_transport=bad)

       def test_empty_string_raises(self):
           # SPEC_TRANSPORT= 视为已设空串，不回退 default，显式报错
           with pytest.raises(ValidationError):
               _make(spec_transport="")

   class TestSpecTransportIsolation:
       def test_does_not_touch_spec_data_host_dir(self):
           s = _make(spec_transport="tar")
           # host_dir 默认值不变，tar 模式仍需要它作为 backend 权威源宿主路径
           assert s.spec_data_host_dir  # 非空，保持默认
           assert s.spec_data_root      # 非空

       def test_strategy_orthogonal(self):
           # D-001: transport 与 strategy 正交，config 层无法测表，但可断言字段存在且独立
           s = _make(spec_transport="tar")
           assert hasattr(s, "spec_transport")
   ```

3. **写实现**：按「接口定义」章节加字段 + validator。

4. **跑测试**：`cd backend && uv run pytest tests/core/test_config_spec_transport.py -v`
   （若测试归 task-08，则至少跑 `uv run pytest tests/core/ -k "config or spec_transport"`）。

5. **类型/风格检查**：`cd backend && uv run mypy app/core/config.py` + `uv run ruff check app/core/config.py`
   必须通过（ci-check hook 会跑 ruff）。

6. **回归**：`cd backend && uv run pytest`（全量，确保未破坏现有 config 相关测试）。

## 验收标准

| AC | 条件 | 验证方式 |
|---|---|---|
| AC-1 | `Settings().spec_transport` 默认值为 `"shared"` | `test_default_is_shared` 通过 |
| AC-2 | 未设 `SPEC_TRANSPORT` env 时值为 `shared`，启动不报错 | `test_env_not_set_uses_shared` 通过 |
| AC-3 | `SPEC_TRANSPORT=shared` / `tar` 正确读入 | `test_normalization` 参数化用例全过 |
| AC-4 | 大小写 / 前后空格规范化（`SHARED`/`Tar`/` shared `） | `test_normalization` 参数化用例全过 |
| AC-5 | 非法枚举值（`http`/`ftp`/`local` 等）抛 `ValidationError` | `test_invalid_enum_raises` 全过 |
| AC-6 | 空串 `SPEC_TRANSPORT=` 抛 `ValidationError`（不静默回退 default） | `test_empty_string_raises` 通过 |
| AC-7 | 字段定义位于 `spec_data_host_dir` 同块，有 description + 设计决策注释 | 代码 review |
| AC-8 | `_normalize_spec_transport` validator 写法对齐 `_resolve_spec_data_root`（mode=before + cls + 单下划线前缀） | 代码 review |
| AC-9 | `SpecWorkspace` 表 / 迁移文件**零改动**（D-001 不入库） | `git diff` 无表/迁移文件 |
| AC-10 | `mypy` + `ruff check` 通过 config.py | ci-check hook 绿 |
| AC-11 | 全量 `pytest` 通过，无回归 | `cd backend && uv run pytest` 绿 |
| AC-12 | D-001@v1（不入库）+ D-002@v1（env + 默认 shared + 规范化）在实现中可追溯（注释/字段） | 代码 review 注释引用 D-001/D-002 |
