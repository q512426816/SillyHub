---
author: qinyi
created_at: 2026-08-10 00:07:07
change: 2026-08-09-security-ppm-ownership
---

# 提案（Proposal）— PPM 代填冒名防护（ownership 校验）

## 动机

CONCERNS.md「2026-08-08 多代理审计」🔴 高危：PPM（项目管理）的执行/工时填报端点**只做认证（谁登录了）不做授权（能不能代别人填）**。7 个写端点经 `get_current_principal` 拿到当前登录 `User` 后，直接把请求体里的「执行人 / 检验人 / 当前执行人 / 工时归属人」字段（`execute_user_id` / `check_user_id` / `current_user_id` / `user_id`）落库——**这些字段调用方可任意填**。后果：任意登录用户可把执行记录/工时记到别人名下（虚报工时、伪造执行、污染绩效与结算数据）。**PPM 已上线**（CLAUDE.md 规则 11）= 真实业务数据风险。

本变更是串行 3 安全 change 之 3（末个）：change 1（凭据卫生）、change 2（incident FSM + SSRF 三连）已归档；本变更收口最后的「PPM 冒名」高危项。

## 边界（做什么 / 不做什么）

**做**：在 7 个执行/工时/负责人写端点的 **service 层**加归属校验——非管理员显式填他人 → HTTP 403；管理员代填放行；自填/省略一切照旧。新建 `ppm/common/ownership.py`（`resolve_owner` 原语 + `PpmOwnershipDenied(403)` 错误类）。

**不做 / 不在范围内（Non-Goals）**（详见 design §3）：不改读端点 / data_scope / DTO·OpenAPI·migration（403 经全局 handler 映射）；不动 `PlanTaskCreate`（建计划 user_id = 计划负责人，计划阶段语义）；不收 problem CRUD 的 `duty_user_id`/`audit_user_id`（指派语义，受 `can_operate_problem` 收口，留 follow-up）；不改 delete 端点越权（篡改/毁证威胁类，留 follow-up）；不加「强制改密」「填报审批流」（超修漏洞范围，留 follow-up）。

## 价值

堵住已上线模块的越权填报漏洞，最小化改动（不改契约/表结构），零行为漂移（None 保留默认、自填写自己照旧、admin 代填照旧），既有测试经 admin stub 透传保持全绿。

## 关联

- 安全审计来源：`.sillyspec/docs/SillyHub/scan/CONCERNS.md`「2026-08-08 多代理审计」🔴 PPM 冒名条目
- 主 plan：`cozy-stirring-corbato.md`（用户锁定决策）
- 详见 [[design]] / [[requirements]] / [[decisions]] / [[tasks]]
