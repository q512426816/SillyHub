---
id: task-02
title: Session 新增 rotated_at 字段
priority: P1
depends_on: []
blocks: [task-03, task-04, task-05]
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/auth/model.py
---

# task-02

## 修改文件

- `backend/app/modules/auth/model.py` —— 在 `Session` 类中新增 `rotated_at` 字段。

> 注意:**本任务只在 ORM 层声明字段映射**,不创建 migration(列实际加在数据库由 task-03 migration 负责)。本任务的字段定义是 task-03 的前置依赖(`op.add_column` 的列定义要与此处对齐)。

## 覆盖来源

- 需求:`FR-02`(Session 新增 `rotated_at` + migration 加列)
- 决策:`D-002@v1`(grace 窗口判定需要 `rotated_at` 记录轮换时刻,配合 `auth_refresh_grace_seconds=60`)
- 设计:`design.md` §5 Phase1(`model.py Session 新增 rotated_at`)、§7 接口定义(model.py 字段定义)、§8 数据模型(`rotated_at TIMESTAMP WITH TIME ZONE NULL`)、§7.5 生命周期契约表(refresh rotate: `revoked_at=now, rotated_at=now`;logout: `rotated_at 保持 null`)。

## 实现要求

1. **仅修改 `Session` 类**,不动 `User`/`Role`/`ApiKey`/`UserWorkspaceRole` 等其它表。
2. 在 `revoked_at` 字段之后追加 `rotated_at` 字段(语义上与 `revoked_at` 同组,便于阅读)。
3. 字段类型 `datetime | None`,默认 `None`,可空。
4. ORM 列定义使用 `sa_column=Column(DateTime(timezone=True), nullable=True)`,与现有 `revoked_at` 风格完全一致(带时区、可空、无索引)。
5. **不**新增索引。grace 查询走 `revoked_at IS NOT NULL` 过滤 + 内存比对 `now - rotated_at`,单机 <1k session 沿用现有遍历策略(§8)。
6. **不**修改 `revoked_at` 的语义或默认值。
7. 保留 ruff line-length 100 约束(`design.md` §12 自审引用 `CONVENTIONS.md`)。
8. 不需要修改 docstring 的核心说明,但建议在 `Session` docstring 或字段行注释一句"rotate 时刻,grace 判定用",方便后续读者理解字段用途。

## 接口定义

字段定义(对齐现有 `revoked_at` 风格,放在 `revoked_at` 之后):

```python
class Session(BaseModel, table=True):
    # ... 现有字段 id/user_id/refresh_token_hash/user_agent/ip/created_at/expires_at/revoked_at ...

    revoked_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    # rotate 时刻:仅 refresh 正常轮换时由 service._mark_session_rotated 写入;
    # logout 主动登出不写;grace 判定用 now - rotated_at < auth_refresh_grace_seconds。
    rotated_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
```

字段语义对照(design §7.5 生命周期契约表):

| 写入场景 | `revoked_at` | `rotated_at` |
|---|---|---|
| login(新行) | null | null |
| refresh 正常 rotate | now | now |
| refresh grace 续期(命中已 rotated) | 保持已 rotated 值 | 保持已 rotated 值(不重复写) |
| refresh 重放(超 grace) | 该 user 全部 session → revoked(沿用现有 `revoke_all_user_sessions`) | rotate 过的保留已写值,未 rotate 的仍 null |
| logout 主动登出 | now | **null**(主动登出不参与 grace) |

## 边界处理

1. **默认 None**:新插入的 `Session` 行(login)默认 `rotated_at=None`,无需传参;只有 refresh 正常 rotate 时才写入,登录态行字段为空。
2. **logout 路径不写**:主动登出走 `_mark_session_revoked`(只设 `revoked_at`),**不**设 `rotated_at`,确保主动登出的 session 不被 grace 判定误纳入(主动登出本就是用户意图终止,无宽限续期诉求)。本任务只在 model 声明字段,不写 logout 逻辑(逻辑由 task-05 保证),但字段语义在 docstring/注释里要注明。
3. **rotate 时才写**:仅 `service._mark_session_rotated`(task-05 新增 helper)同时写 `revoked_at` + `rotated_at`,二者使用同一个 `now` 值(`design.md` §7 `_mark_session_rotated`)。
4. **grace 判定读取它**:task-05 的 `_consume_refresh_token` 在命中已 revoked session 时用 `now - rotated_at < auth_refresh_grace_seconds` 判定 grace 窗口;`rotated_at` 为 None(理论上 revoked_at 非空但 rotated_at 为空,即旧版本数据/logout 路径)时,grace 判定需视为"无轮换时刻" → 走重放吊销保守路径(由 task-05 处理,model 只保证字段存在)。
5. **不加索引**:单机 <1k session,grace 查询先按 `revoked_at IS NOT NULL`(已有 `ix_sessions_user_revoked` 复合索引可复用过滤)再内存比对 `rotated_at`,无需新索引(`design.md` §8)。
6. **旧数据 NULL 不报错**:migration(task-03)对历史行 `ADD COLUMN ... NULL` 不回填;本字段 `default=None`,ORM 读取历史行 `rotated_at=None` 不报错,grace 判定按边界 4 处理。
7. **时区一致**:使用 `DateTime(timezone=True)` 与 `created_at/expires_at/revoked_at` 一致,避免 UTC 与本地时区混用导致 grace 窗口计算偏移。

## 非目标

- **不**改 `revoked_at` 语义或默认值(保持现状)。
- **不**新增任何索引(含 `rotated_at` 单列索引、复合索引)。
- **不**改 `User`/`ApiKey`/`Role`/`UserWorkspaceRole` 等其它表。
- **不**创建 alembic migration(由 task-03 负责);本任务不碰 `backend/migrations/`。
- **不**改 `service.py` 写入逻辑(`_mark_session_rotated` 由 task-05 实现);本任务只声明字段。
- **不**改 `schema.py` 的 `TokenPair`/请求响应 DTO。

## 参考

`Session` 现有字段定义风格(`backend/app/modules/auth/model.py:82-116`),`revoked_at` 是本字段的对齐模板:

```python
# 现有 revoked_at(model.py:113-116)—— rotated_at 完全对齐此风格
revoked_at: datetime | None = Field(
    default=None,
    sa_column=Column(DateTime(timezone=True), nullable=True),
)
```

同样带 `default=None` + `sa_column=Column(DateTime(timezone=True), nullable=True)` 的还有 `User.last_login_at`、`User.deleted_at`、`ApiKey.last_used_at`、`ApiKey.expires_at`、`ApiKey.revoked_at`,均为可空带时区时间戳,本字段沿用同一约定。

## TDD 步骤

本任务为纯 ORM 字段声明(无独立逻辑分支),TDD 形式为"字段存在性 + 默认值"的轻量验证,跟随 task-04/05 的 service 测试一起转绿:

1. **(读码)** 已确认 `Session` 现有字段清单(`model.py:82-116`)与 `revoked_at` 风格。
2. **(写测试·跟随 task-04)** 在 task-04 的 `test_refresh_grace_window.py` 中,grace 用例会读取 `session.rotated_at`;本任务保证字段可被读取(否则 AttributeError)。
3. **(写实现)** 在 `Session` 类 `revoked_at` 之后追加 `rotated_at` 字段(见"接口定义")。
4. **(跑测试)** `cd backend && uv run ruff check app/modules/auth/model.py`(lint 守护);字段存在性由后续 task-04/05 测试间接验证(grace 判定读 `rotated_at`,若字段缺失测试 AttributeError 红)。
5. **(验收)** 见下方验收标准表格。
6. **(更新文档)** task-10 收口时同步 `docs/` 下 auth 模块文档的字段说明。

> 说明:本任务无独立红→绿测试文件,字段声明本身的正确性由 task-03(migration 加列成功 = 列与 ORM 映射一致)与 task-05(grace 测试读 `rotated_at` 通过)联合验收。这是 model-only 任务的标准 TDD 形态(测试驱动在消费方 task-04/05)。

## 验收标准

| 编号 | 验收项 | 验证方式 | 通过标准 |
|---|---|---|---|
| AC-02-1 | `Session` 类新增 `rotated_at` 字段 | 读 `backend/app/modules/auth/model.py` | `Session` 类存在 `rotated_at: datetime \| None` 属性 |
| AC-02-2 | 字段类型与可空性正确 | 读字段定义 | `sa_column=Column(DateTime(timezone=True), nullable=True)`,`default=None` |
| AC-02-3 | 风格对齐 `revoked_at` | diff 比对 | 与 `revoked_at` 使用相同的 `Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))` 模式 |
| AC-02-4 | 未新增索引 | 读 `__table_args__` | `__table_args__` 仍为 `(Index("ix_sessions_user_revoked", "user_id", "revoked_at"),)`,无新增 Index |
| AC-02-5 | 未改 `revoked_at` 语义 | diff 比对 | `revoked_at` 定义与默认值未变 |
| AC-02-6 | 未动其它表 | diff 范围 | 仅 `Session` 类有改动;`User`/`Role`/`ApiKey`/`UserWorkspaceRole` 未变 |
| AC-02-7 | lint 通过 | `cd backend && uv run ruff check app/modules/auth/model.py` | 无报错(line-length 100 等) |
| AC-02-8 | ORM 可实例化不报错 | `cd backend && uv run python -c "from app.modules.auth.model import Session; s = Session(user_id=None, refresh_token_hash='x', expires_at=datetime.now(UTC)); assert s.rotated_at is None"` | 退出码 0,`rotated_at` 默认 None |
