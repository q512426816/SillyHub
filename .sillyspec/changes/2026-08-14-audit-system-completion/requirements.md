---
author: qinyi
created_at: 2026-08-14 14:05:38
---

# 需求（Requirements）

## 功能需求

- **FR-01** production 挂载自动审计：`backend/app/main.py` lifespan 内调用 `register_audit_hooks(engine)`；重复调用（测试多次 create_app）不重复注册。
- **FR-02** 审计常量集中定义（D-005）：`backend/app/modules/workflow/model.py` AuditLog 类旁定义 `AUTH_LOGIN_SUCCESS` / `AUTH_LOGIN_FAILED` / `PLATFORM_SETTING_CREATE` / `PLATFORM_SETTING_UPDATE` 五个 action 常量 + `AUDIT_PLACEHOLDER_ID = uuid.UUID(int=0)`。依 Design Grill C-6（settings 全仓无 delete 端点）**不设 `PLATFORM_SETTING_DELETE`**——design §4.2 原列六个常量，此处为审查后精化，若后续新增 settings delete 端点再补常量。
- **FR-03** 登录成功审计：`auth/service.py login()` 成功路径产生一条 AuditLog（action=AUTH_LOGIN_SUCCESS，resource_type="user"，resource_id=真实 user.id，workspace_id=None，details_json 含 account/ip/user_agent）。
- **FR-04** 登录失败/禁登审计（D-002）：失败（AuthInvalidCredentials）与禁登（AuthUserLoginDisabled）两分支在 raise 前显式 commit 审计行（resource_id=AUDIT_PLACEHOLDER_ID，details_json 含 account/ip/reason=invalid_credentials|login_disabled）；审计写入失败仅 log.error 不阻断原错误返回。
- **FR-05** settings 变更审计（D-004，Grill C-7 落点精化）：settings 写路径（`settings/router.py` PUT 循环 + `_write_setting_json`，:80-108/:168-189）产生 AuditLog（action=PLATFORM_SETTING_CREATE 或 _UPDATE，resource_type="platform_setting"，resource_id=AUDIT_PLACEHOLDER_ID，details_json 含 key/from/to）；**per-key 粒度**（批量 PUT 每个 key 一条，可追溯单 key 变更）。
- **FR-06** 测试：三组用例——①hooks 生效（有 ctx 写→审计产生、无 ctx→不产生、audit_logs 不递归）②登录三路径审计③settings 审计。
- **FR-07** 全量 backend pytest 回归通过；受现存断言影响时按「查询加 action/resource_type 过滤」修正，禁止删断言。

## 决策覆盖对照

| 决策 | 覆盖 |
|---|---|
| D-001@v1 排除表最小改动+观察 | FR-01（不改 _EXCLUDED_TABLES）+ design §3/R-02 |
| D-002@v1 登录失败全零占位 | FR-02/FR-04 |
| D-003@v1 手工/hooks 双轨并存 | design §3 非目标（不删手工）+ R-04 |
| D-004@v1 settings 手工插入 | FR-02/FR-05 |
| D-005@v1 方案 B 常量集中 | FR-02（service 不内联字面量） |

全部 D-001~D-005 当前版本已覆盖，无剩余未覆盖决策。

## 剩余风险

- Grill needs_thinking 之一「登录失败审计 actor_id 取值」：AuditLog.actor_id 可空，登录失败无认证主体，**取 None**（details 的 account 提供线索），随 FR-04 实现与测试固化；
- sessions 轮换等用户请求写将产生审计行（R-02，D-001 观察机制兜底）。
