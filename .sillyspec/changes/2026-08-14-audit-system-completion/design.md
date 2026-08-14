---
author: qinyi
created_at: 2026-08-14T22:30:00+08:00
scale: large
---

# 审计体系补全（audit-system-completion）design

## 1. 背景

依据 `docs/architecture-4a.md` §8 漂移点 #1/#2/#3 + §1.3 审计双轨缺口：

1. `core/audit_hooks.py:290 register_audit_hooks` 设计为对所有 BaseModel 子类 insert/update/delete 自动写 `AuditLog`（排除 audit_logs 防递归 + audit_context 缺失跳过 + 非 UUID 单主键跳过 + 幂等注册），**但 production `main.py` 的 create_app/lifespan 从未调用它**，运行态休眠；实际靠约 20 处 service 内手工 AuditLog 插入。
2. 登录成功/失败仅 `log.info` 结构化日志（`auth/service.py:111,129`），不入 `audit_logs` 表，无法用于暴力破解追溯。
3. `settings`/`PlatformSetting` 变更因自动钩子未挂且未手工补，实际无任何审计。

读码确认的三个关键事实（影响方案）：

- hooks 只在有 `audit_context`（`core/db.py:116-151` 经 get_session 从 Bearer token 注入）的请求里写审计——**daemon/后台任务写天然不触发**（性能天然可控，同时也是覆盖缺口，本期不做）；
- `platform_settings` PK 为 String 非 UUID，`_get_resource_id` 返回 None 直接跳过——**挂 hooks 也不会自动审计 settings，必须手工插入**；
- 登录请求无 Bearer → 无 audit_context——**登录审计必须手工构造 AuditLog**，且登录失败可能无 user（`AuditLog.resource_id` 非空 UUID 是硬约束）。

## 2. 设计目标

1. production 挂载 `register_audit_hooks`，使有用户上下文的 ORM 写入自动落 `audit_logs`；
2. 登录成功/失败/禁登三种路径入审计表（action 可区分，含 account/IP，可追溯暴力破解）；
3. settings 写操作（create/update/delete）入审计表；
4. 全量 backend 回归不破。

## 3. 非目标（不在范围内）

- 审计表清理/归档/轮转策略（审计增长治理另立变更）；
- daemon 侧写操作审计（无 audit_context 天然豁免，补齐需 actor 模型设计，另议）;
- `AuditLog` schema 变更（resource_id 保持非空 UUID，用占位绕行，不改迁移）；
- 扩大 `_EXCLUDED_TABLES`（观察机制后再议，见 D-001）。

## 4. 总体方案（方案 B · 常量集中）

### 4.1 挂载（`backend/app/main.py`）

lifespan 内（engine 就绪、模型 import 完成后）调用 `register_audit_hooks(engine)`（一行）。幂等（`event.contains` 检查）保证测试里多次 `create_app` 安全。`audit_context` 注入链已存在，不动。

### 4.2 常量（`backend/app/modules/workflow/model.py`，AuditLog 类旁）

- `AUTH_LOGIN_SUCCESS = "auth.login.success"` / `AUTH_LOGIN_FAILED = "auth.login.failed"`
- `PLATFORM_SETTING_CREATE = "platform_setting.create"` / `_UPDATE` / `_DELETE`
- `AUDIT_PLACEHOLDER_ID = uuid.UUID(int=0)`（全零占位，D-002/D-004 共用单一定义）

### 4.3 登录审计（`backend/app/modules/auth/service.py` login 三分支）

- **成功**（`:111` log.info 后）：`AuditLog(actor_id=user.id, action=AUTH_LOGIN_SUCCESS, resource_type="user", resource_id=user.id, workspace_id=None, details_json={account, ip, user_agent})`，随现有 `self._db.commit()` 落库；
- **失败**（`:94-96` raise AuthInvalidCredentials 前）/ **禁登**（`:102-106` raise 前）：`resource_id=AUDIT_PLACEHOLDER_ID`，details_json 存 `{account, ip, reason}`（invalid_credentials / login_disabled）。**关键：raise 前显式 commit 审计行**，否则异常回滚丢审计；审计写入用 try/except 包裹，写失败仅 log.error 不阻断原登录错误。

### 4.4 settings 审计（settings 模块写路径）

create/update/delete 各插手工 AuditLog：`action=PLATFORM_SETTING_*`，`resource_type="platform_setting"`，`resource_id=AUDIT_PLACEHOLDER_ID`，`details_json={"key": <setting key>, "from": <旧值>, "to": <新值>}`，actor 取路由认证主体。具体落点（service vs router 内联）由 plan 阶段 task 卡 grep 定位后精化。

### 4.5 测试策略

三组新增：

1. **hooks 生效**：有 audit_context 的 insert/update/delete 各产生一条 AuditLog（action/resource_type 正确）；无 audit_context 不产生；audit_logs 自身写入不递归。
2. **登录审计**：成功（真实 user.id）/ 失败（占位 + reason=invalid_credentials）/ 禁登（占位 + reason=login_disabled）三路径。
3. **settings 审计**：update 产生 AuditLog（key 与 from/to 存 details）。

回归：挂 hooks 全局生效，全量 backend pytest 一轮，受影响断言按「查询加 action/resource_type 过滤」修正（禁止删断言凑绿）。

## 5. 文件变更清单

| 文件 | 变更 |
|---|---|
| `backend/app/main.py` | 修改：lifespan 挂 `register_audit_hooks` |
| `backend/app/modules/workflow/model.py` | 修改：AuditLog 旁定义 6 个 action 常量 + `AUDIT_PLACEHOLDER_ID` |
| `backend/app/modules/auth/service.py` | 修改：login 三分支手工 AuditLog |
| `backend/app/modules/settings/`（写路径，plan 定位） | 修改：create/update/delete 手工 AuditLog |
| `backend/tests/`（audit_hooks 生效用例） | 新增 |
| `backend/tests/modules/auth/`（登录审计用例） | 新增 |
| `backend/tests/modules/settings/`（settings 审计用例） | 新增 |

## 6. 接口定义

无新增对外 API / schema / 迁移。新增模块内常量（action 字符串 + 全零 UUID）；`audit_logs` 表新增 action 取值（`auth.login.*` / `platform_setting.*`），前端审计查询页按 action 过滤天然兼容，无 breaking。

## 7. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 挂 hooks 全局生效，现存测试断言受新增审计行影响（如断言表行数/计数） | P1 | 全量 backend pytest 回归；受影响断言加 action/resource_type 过滤修正，禁删断言 |
| R-02 | sessions 轮换等高频用户请求写产生大量审计行 | P1 | 上线观察 audit_logs 增速；超预期再扩 `_EXCLUDED_TABLES`（D-001 观察机制，另立 quick） |
| R-03 | 登录失败审计在 raise 前写，commit 失败或与异常处理器竞争 | P2 | 审计写入 try/except 包裹 + raise 前显式 commit；测试覆盖失败路径审计确实落库 |
| R-04 | 手工（语义化 action）与 hooks（通用 action）双轨冗余，同一操作两条记录 | P2 | 接受（D-003 明确决策）；查询按 action 过滤可区分语义轨/全量轨 |

## 8. 决策追踪

见 `decisions.md`。D-001（排除表最小改动+观察）→ §4.1/§3/R-02；D-002（登录失败全零占位）→ §4.2/§4.3；D-003（双轨并存）→ §3/R-04；D-004（settings 手工插入）→ §4.2/§4.4；D-005（方案 B 常量集中）→ §4.2。全部已确认，无未解决项。

## 9. 生命周期契约

生命周期契约：无（本变更仅新增 AuditLog 行写入与常量定义，不改变任何实体的状态流转；audit_hooks 监听 ORM after_insert/update/delete 事件做记录，非状态机；不涉及 session/lease/agent_run 的生命周期变更）。

## 10. 自审（Self-Review）

- 三个漂移点（#1 挂载 / #2 登录 / #3 settings）全部覆盖，各有测试对应 ✓
- 与 D-001~D-005 五项已确认决策逐条一致，无非授权偏离 ✓
- 覆盖检查：audit_context 缺失路径（daemon 写）已在非目标显式声明，不算隐性缺口 ✓
- YAGNI：未引入 helper 层（C 方案已否决）、未改 schema、未扩排除表 ✓
- ⚠️ 自审存疑 1：settings 写路径落点（service vs router 内联）未实测定位，留给 plan 阶段 task 卡 grep 后精化，不影响 design 结构；
- ⚠️ 自审存疑 2：登录失败分支「raise 前显式 commit」与 FastAPI 异常处理器/依赖注入 session 关闭的竞争窗口，execute 阶段用测试实证（R-03 应对已列）。
