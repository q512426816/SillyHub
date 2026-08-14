---
author: qinyi
created_at: 2026-08-14 14:25:00
---

# 模块影响分析（Module Impact）— 审计体系补全

依据 `_module-map.yaml`（backend 模块 paths=`backend/**`），本次全部变更文件归属 **backend** 单模块：

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend | 修改 | ① `app/main.py` lifespan 挂载 register_audit_hooks（task-02）② `app/modules/workflow/model.py` 新增 5 审计 action 常量 + AUDIT_PLACEHOLDER_ID（task-01）③ `app/modules/auth/service.py` login 三分支手工审计（task-03）④ `app/modules/settings/router.py` 两处 upsert per-key 审计（task-04） |
| backend | 新增（测试） | hooks 生效用例 / 登录审计用例 / settings 审计用例（task-03/04/05） |

无依赖变更（不改任何模块对外接口/依赖方向）；无 frontend / sillyhub-daemon / deploy 影响。

execute/verify 阶段按实际代码变更更新本文档；archive 阶段终审。
