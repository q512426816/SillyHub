---
author: qinyi
created_at: 2026-08-09T13:01:53
---

# 决策台账 — 2026-08-09-security-credentials-hygiene

> 本文件是本次变更的实现/验收决策台账。只记录对实现与验收有影响的决策。

## D-001@v1 · 明文密码修复落点 = 前端 localStorage

- **type**: premise
- **status**: accepted
- **source**: code + audit
- **question**: 「登录明文密码」问题落点在后端日志还是前端？
- **answer**: 后端 Python 日志链路逐点核对无任何打明文密码的点（auth/service.py 全部日志只打 user_id/email/session_id，monitoring 慢查询只打 sql+parameters 且登录是 SELECT 不含密码）。真正落点是前端登录页把密码明文存 localStorage（`(auth)/login/page.tsx:73-80`、`m/login/page.tsx:136-139`）。
- **normalized_requirement**: 本变更修前端 localStorage 明文密码存储，不修后端日志。
- **impacts**: [FR-01, FR-04]
- **evidence**: auth/service.py:111/129/144/157 日志字段；CONCERNS.md:28 指向前端；探查报告 §1
- **priority**: high

## D-002@v1 · 弱口令校验层 = config field_validator（方案 A）

- **type**: architecture
- **status**: accepted
- **source**: user
- **question**: 弱口令强度校验放在哪一层？config field_validator / bootstrap service 层 / 仅 log 告警？
- **answer**: 放 `config.py` 的 `field_validator`（方案 A），配置加载期 fail-fast，Settings 实例化即拒，连 lifespan 都不进。
- **normalized_requirement**: `config.py` 新增 `field_validator("platform_bootstrap_admin_password")`，弱口令表 + 与 email 本地部分相同 → ValueError；复用 :204/212/279 同款模式。
- **impacts**: [FR-05, task-config-validator]
- **evidence**: 用户 step4 选「方案A」；config.py:204/212/279 现有 field_validator 先例
- **priority**: high

## D-003@v1 · 不做强制首登改密流程（不做 ②）

- **type**: boundary
- **status**: accepted
- **source**: user
- **question**: 是否加 `must_change_password` 强制首登改密流程？
- **answer**: 不做。需加 User 列 + migration + 登录拦截 + 改密页 + 前端跳转，改动大且冲击 PPM 在线账号。config fail-fast 已消除「弱默认口令」风险，强制改密列 follow-up。
- **normalized_requirement**: 本变更不加 `User.must_change_password` 列、不加登录强制改密拦截。
- **impacts**: [Non-Goals]
- **evidence**: 用户拍板「①+③不做②」；项目除 PPM 外未上线（CLAUDE.md 规则 11）
- **priority**: medium

## D-004@v1 · bootstrap「已存在不更新密码」语义保留

- **type**: compatibility
- **status**: accepted
- **source**: code
- **question**: 弱口令强度校验是否对已存在的 DB admin 生效？
- **answer**: 不生效。强度校验在 config 层（启动加载期），只对本次启动注入的口令生效；bootstrap「账号已存在则不更新密码」（service.py:388）语义保留，避免线上已有 admin 被锁死。
- **normalized_requirement**: 弱口令 validator 只在 `platform_bootstrap_admin_password` 非空（本次注入）时校验；DB 已有 admin 不触发改密。
- **impacts**: [FR-05]
- **evidence**: auth/service.py:384-404（existing is None 才建）；config.py:158
- **priority**: medium
