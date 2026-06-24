---
id: task-01
title: config 新增 auth_refresh_grace_seconds + access TTL 15→30min
priority: P1
depends_on: []
blocks: [task-04, task-05]
requirement_ids: [FR-03]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - backend/app/core/config.py
---

# task-01

> 本任务为 Wave 1 后端基础设施,无依赖,可并行起步。它是 task-04(后端测试)与 task-05(service grace 改造)的前置——后两者都直接读取本任务产出的 `auth_refresh_grace_seconds` / `auth_access_ttl_minutes` 配置。

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/core/config.py` | `Settings` 类 Auth 段:新增 `auth_refresh_grace_seconds` 字段;`auth_access_ttl_minutes` 默认值 `15 → 30` |

仅此 1 个文件。不允许触碰 model/service/migration/前端任何文件(分属 task-02/03/05/07+)。

## 覆盖来源

| 来源 | 章节 | 落点 |
|---|---|---|
| design.md §5 Phase1 | `config.py` 新增 `auth_refresh_grace_seconds=60`;`auth_access_ttl_minutes` 默认 `15 → 30` | 两字段定义 |
| design.md §7 接口定义 | `auth_refresh_grace_seconds: int = Field(60, ge=0, le=600)`、`auth_access_ttl_minutes: int = Field(30, ge=1, le=24 * 60)`(默认 15→30) | 字段签名 + 约束 |
| design.md §8 数据模型 | grace 判定用 `now - rotated_at < auth_refresh_grace_seconds` | 字段语义(60s 宽限窗口) |
| design.md §9 兼容策略 | `grace=60s` 可配置,设为 0 时退化为旧行为(回退旋钮);TTL 15→30 为默认值变更,`/api/auth/refresh` 的 `access_expires_in` 随之变化 | `ge=0` 边界 + brownfield 不做兼容 |
| plan.md 任务总表 task-01 行 | 文件 `backend/app/core/config.py`,覆盖 FR-03, D-002, D-003,完成标准:`auth_refresh_grace_seconds=60`(ge=0,le=600)、`auth_access_ttl_minutes` 默认 30 | 验收锚点 |
| proposal FR-03 | access token 默认 30min | TTL 默认值 |
| decisions.md D-002@v1 | grace=60s | 新字段 + 默认 60 |
| decisions.md D-003@v1 | access TTL 15→30 | 默认值变更 |

## 实现要求

1. **新增字段** `auth_refresh_grace_seconds`,放在现有 Auth 段(`# ── Auth (task-04a) ──` 注释块内),紧跟 `auth_refresh_ttl_days` 之后、`auth_bcrypt_rounds` 之前(按"token 生命周期"语义就近聚合)。签名严格按 design §7:
   ```python
   auth_refresh_grace_seconds: int = Field(60, ge=0, le=600)
   ```
2. **修改默认值** `auth_access_ttl_minutes`:`15 → 30`。Field 约束 `ge=1, le=24 * 60` **保持不变**,只改第一个位置参数(默认值)。
3. **字段顺序**:grace 字段与 ttl 字段同属 Auth 段,新增字段写在该段内即可,无需新建注释段。
4. **不加 `field_validator`**:本字段是纯整数 + Pydantic 内置 ge/le 约束,无需自定义校验器(区别于 `spec_transport` 那种需要 normalize 的字段)。
5. **不改 `model_config`**:`env_file`/`case_sensitive=False`/`extra="ignore"` 已支持环境变量覆盖(`AUTH_REFRESH_GRACE_SECONDS`、`AUTH_ACCESS_TTL_MINUTES` 自动绑定,pydantic-settings 不区分大小写)。
6. **brownfield 处理**:项目未上线、数据可清空(`CLAUDE.md` 规则 8),TTL 默认值变更**无需**为已签发的旧 15min token 做兼容,直接用新默认 30。

## 接口定义(字段定义)

### 新增字段

```python
auth_refresh_grace_seconds: int = Field(
    60,
    ge=0,
    le=600,
    description=(
        "Refresh token 轮换宽限窗口(秒)。同一 refresh token 在 rotate 后该窗口内"
        "再次被提交时,重新签发新对而不触发 revoke_all(并发刷新误杀兜底)。"
        "设为 0 时退化为旧行为(rotate 后立即按重放处理)。范围 0–600s。"
        "对应 design D-002@v1 / FR-03 grace。"
    ),
)
```

### 修改字段(仅默认值)

```python
# 原:auth_access_ttl_minutes: int = Field(15, ge=1, le=24 * 60)
auth_access_ttl_minutes: int = Field(
    30,
    ge=1,
    le=24 * 60,
    description=(
        "Access token 有效期(分钟)。默认 30min(原 15min,design D-003@v1 调整,"
        "降低被动 401 刷新频率)。范围 1–1440min。环境变量 AUTH_ACCESS_TTL_MINUTES 可覆盖。"
    ),
)
```

### 环境变量绑定(pydantic-settings 自动,无需手写)

| 字段 | 环境变量名 | 示例值 |
|---|---|---|
| `auth_refresh_grace_seconds` | `AUTH_REFRESH_GRACE_SECONDS` | `60` / `0`(关闭 grace) |
| `auth_access_ttl_minutes` | `AUTH_ACCESS_TTL_MINUTES` | `30` |

> `case_sensitive=False`(见 `model_config`),环境变量大小写不敏感。

## 边界处理

| # | 边界场景 | 期望行为 | 依据 |
|---|---|---|---|
| B-01 | `auth_refresh_grace_seconds=0`(显式设为 0,或环境变量 `AUTH_REFRESH_GRACE_SECONDS=0`) | 退化为旧行为:service 层 `now - rotated_at < 0` 恒为 False → 走重放吊销分支,不再 grace 续期。提供回退旋钮 | design §9 兼容策略 |
| B-02 | `auth_refresh_grace_seconds` 超上限(如 601、3600) | Pydantic `le=600` 触发 `ValidationError`,Settings 加载失败,进程启动报错(配置错误应 fail-fast,不静默截断) | Field `le=600` |
| B-03 | `auth_refresh_grace_seconds` 负数(如 -1) | Pydantic `ge=0` 触发 `ValidationError`,启动失败 | Field `ge=0` |
| B-04 | `auth_access_ttl_minutes` 超 TTL 边界(如 0、1441、负数) | 约束不变(`ge=1, le=24*60`),越界触发 `ValidationError`;此为本任务**不改**的既有约束,仅确认未被破坏 | Field `ge=1, le=24*60`(保持) |
| B-05 | TTL 默认值 15→30 后,已签发的旧 token(按 15min 签发) | 不做兼容:旧 token 仍按其自身 `exp` 过期(签名时已写入 exp),新签发的才用 30min。项目未上线数据可清空,无需迁移旧 token(`CLAUDE.md` 规则 8 / design §9) | brownfield 策略 |
| B-06 | 环境变量同时覆盖两个字段 | 两者独立生效,互不影响;环境变量优先级 > `.env` > 代码默认值(pydantic-settings 标准行为) | `model_config` env_file |
| B-07 | 环境变量传入非整数(如 `AUTH_REFRESH_GRACE_SECONDS=abc`) | Pydantic int 解析失败 → `ValidationError`,启动失败(不静默回退默认 60) | pydantic int 类型 |

## 非目标

- **不**修改 `auth_refresh_ttl_days`(refresh token 14 天 TTL 保持不变)。
- **不**修改 `auth_bcrypt_rounds`(密码哈希轮数与本变更无关)。
- **不**修改任何 `platform_bootstrap_admin_*` 字段。
- **不**新增 migration / 不改 `Session` model(`rotated_at` 字段属 task-02)。
- **不**改 service.py 的 grace 判定逻辑(属 task-05,本任务只提供配置)。
- **不**为 TTL 默认值变更做向后兼容(无版本迭代兼容需求,`CLAUDE.md` 规则 8)。
- **不**改 `model_config`、不加 `field_validator`。

## 参考(现有 auth 字段 Field 风格)

现有 Auth 段(`config.py:45-51`)风格统一,本任务严格沿用:

```python
# ── Auth (task-04a) ────────────────────────────────────────────────
auth_access_ttl_minutes: int = Field(15, ge=1, le=24 * 60)
auth_refresh_ttl_days: int = Field(14, ge=1, le=90)
auth_bcrypt_rounds: int = Field(12, ge=4, le=15)
```

风格要点(必须遵守):
- 单行 Field(约束短)或多行(带 description);本项目多数无 description、靠 `ge/le` 自解释。本任务新增字段**建议带 description**(因语义非自明,grace 概念需注释),TTL 字段可保持单行或加简短 description。
- 整数类型注解显式 `: int`。
- 约束用 `ge`/`le`(下界/上界),不用 `gt`/`lt`(边界值合法)。
- 字段名 `snake_case`,环境变量自动转 `SCREAMING_SNAKE_CASE`。
- 无 `field_validator`(纯数值约束不需要)。

## TDD 步骤

> 本任务字段定义简单、无分支逻辑,TDD 以"配置加载契约"测试为主。优先复用/扩展现有 `app/core` 配置测试;若无对应测试文件,按下方新增。

### 步骤 1 · 读现有代码(已读)

`backend/app/core/config.py:45-51` Auth 段确认。检查现有 config 测试位置:
```bash
ls backend/app/core/tests/ 2>/dev/null || ls backend/tests/core/ 2>/dev/null
grep -rn "auth_access_ttl_minutes\|auth_refresh_grace" backend/ --include="*.py"
```

### 步骤 2 · 写测试(红)

在 config 测试文件中新增用例(若不存在则新建 `backend/app/core/tests/test_config_auth.py`):

```python
import pytest
from pydantic import ValidationError

from app.core.config import Settings


def _base_kwargs(**overrides):
    """最小合法 Settings 构造参数(database_url/secret_key 必填)。"""
    return {
        "database_url": "postgresql+asyncpg://u:p@localhost/db",
        "secret_key": "x" * 16,
        **overrides,
    }


class TestAuthRefreshGraceSeconds:
    def test_default_is_60(self):
        s = Settings(**_base_kwargs())
        assert s.auth_refresh_grace_seconds == 60

    def test_env_override(self, monkeypatch):
        monkeypatch.setenv("AUTH_REFRESH_GRACE_SECONDS", "120")
        s = Settings(**_base_kwargs())
        assert s.auth_refresh_grace_seconds == 120

    def test_zero_allowed_degrades_to_legacy(self):
        """grace=0 合法,退化为旧行为(回退旋钮)。"""
        s = Settings(**_base_kwargs(auth_refresh_grace_seconds=0))
        assert s.auth_refresh_grace_seconds == 0

    def test_negative_rejected(self):
        with pytest.raises(ValidationError):
            Settings(**_base_kwargs(auth_refresh_grace_seconds=-1))

    def test_over_upper_bound_rejected(self):
        with pytest.raises(ValidationError):
            Settings(**_base_kwargs(auth_refresh_grace_seconds=601))

    def test_upper_bound_600_allowed(self):
        s = Settings(**_base_kwargs(auth_refresh_grace_seconds=600))
        assert s.auth_refresh_grace_seconds == 600


class TestAuthAccessTtlDefault30:
    def test_default_is_30(self):
        s = Settings(**_base_kwargs())
        assert s.auth_access_ttl_minutes == 30

    def test_env_override_back_to_15(self, monkeypatch):
        """环境变量可覆盖回 15(验证可配置,非硬编码)。"""
        monkeypatch.setenv("AUTH_ACCESS_TTL_MINUTES", "15")
        s = Settings(**_base_kwargs())
        assert s.auth_access_ttl_minutes == 15

    def test_constraints_unchanged(self):
        """ge=1 / le=1440 约束未因默认值变更而破坏。"""
        with pytest.raises(ValidationError):
            Settings(**_base_kwargs(auth_access_ttl_minutes=0))
        with pytest.raises(ValidationError):
            Settings(**_base_kwargs(auth_access_ttl_minutes=1441))
        s = Settings(**_base_kwargs(auth_access_ttl_minutes=1440))
        assert s.auth_access_ttl_minutes == 1440
```

运行,预期 **RED**(字段尚未新增、默认值仍是 15):
```bash
cd backend && uv run pytest app/core/tests/test_config_auth.py -q
```

### 步骤 3 · 写实现(绿)

编辑 `backend/app/core/config.py`,Auth 段改为:

```python
# ── Auth (task-04a) ────────────────────────────────────────────────
auth_access_ttl_minutes: int = Field(
    30,
    ge=1,
    le=24 * 60,
    description="Access token 有效期(分钟)。默认 30min(D-003@v1:15→30,降低 401 刷新频率)。",
)
auth_refresh_ttl_days: int = Field(14, ge=1, le=90)
auth_refresh_grace_seconds: int = Field(
    60,
    ge=0,
    le=600,
    description=(
        "Refresh token 轮换宽限窗口(秒)。rotate 后窗口内重复提交换新而非 revoke_all"
        "(并发刷新误杀兜尾)。0=退化为旧行为。D-002@v1。"
    ),
)
auth_bcrypt_rounds: int = Field(12, ge=4, le=15)
```

### 步骤 4 · 跑测试(绿)

```bash
cd backend && uv run pytest app/core/tests/test_config_auth.py -q
cd backend && uv run pytest app/core -q          # 回归现有 core 测试
```
全绿。同时跑 ruff 守护风格:
```bash
cd backend && uv run ruff check app/core/config.py
```

### 步骤 5 · 验收 + 更新文档

对照下方验收标准逐条核对;如 `docs/modules/` 下有 config 模块文档涉及 auth 字段清单,同步补 `auth_refresh_grace_seconds` 与 TTL 新默认(参考 MEMORY `scan-regenerates-module-docs.md`:scan 会重生 module-card,手动补充融进"注意事项"而非加变更索引)。

## 验收标准

| AC | 标准 | 验证方法 | 状态 |
|---|---|---|---|
| AC-01 | `Settings()` 默认 `auth_refresh_grace_seconds == 60` | `pytest test_default_is_60` | ☐ |
| AC-02 | `Settings()` 默认 `auth_access_ttl_minutes == 30`(原 15) | `pytest test_default_is_30` | ☐ |
| AC-03 | `auth_refresh_grace_seconds` 支持 `ge=0`(0 合法,退化旧行为) | `pytest test_zero_allowed_degrades_to_legacy` | ☐ |
| AC-04 | `auth_refresh_grace_seconds` 上界 `le=600`(600 合法、601 拒绝) | `pytest test_over_upper_bound_rejected test_upper_bound_600_allowed` | ☐ |
| AC-05 | `auth_refresh_grace_seconds` 负数拒绝(`ge=0`) | `pytest test_negative_rejected` | ☐ |
| AC-06 | `auth_access_ttl_minutes` 约束 `ge=1, le=24*60` 未被破坏(0/1441 拒绝、1440 合法) | `pytest test_constraints_unchanged` | ☐ |
| AC-07 | 两字段均可被环境变量覆盖(`AUTH_REFRESH_GRACE_SECONDS` / `AUTH_ACCESS_TTL_MINUTES`) | `pytest test_env_override test_env_override_back_to_15` | ☐ |
| AC-08 | 环境变量非整数(如 `abc`)触发 `ValidationError`,不静默回退默认 | 手测 `AUTH_REFRESH_GRACE_SECONDS=abc uv run python -c "from app.core.config import Settings; Settings(database_url='x',secret_key='x'*16)"` 预期非零退出 | ☐ |
| AC-09 | 只改 `backend/app/core/config.py` 一个文件,未触碰 model/service/migration/前端 | `git diff --name-only` 仅 1 行 | ☐ |
| AC-10 | 现有 `app/core` 测试全部回归通过(TTL 默认值变更未破坏其它依赖 15 的测试) | `cd backend && uv run pytest app/core -q` 全绿 | ☐ |
| AC-11 | ruff 风格通过 | `cd backend && uv run ruff check app/core/config.py` 无告警 | ☐ |
| AC-12 | FR-03 / D-002@v1 / D-003@v1 覆盖:grace 字段已落地(60s)+ TTL 默认 30min | AC-01 + AC-02 组合 | ☐ |

---

> 完成本任务后,task-04(后端 grace 测试)与 task-05(service 改造)的前置配置就绪。task-05 将在 `_consume_refresh_token` 中读取 `settings.auth_refresh_grace_seconds` 做 `now - rotated_at < grace` 判定。
