---
author: qinyi
created_at: 2026-06-22T01:30:00
---

# 验证报告 — 登录支持邮箱/账号 + 平台选择

## 结论
**PASS WITH NOTES**（contract-required 变更,contract test 通过;迁移实测待 PG 环境）

## 任务完成度
task-01~07 全 ✅(7/7):
- 01 User.username 字段 ✅
- 02 alembic 迁移(加列+回填去重+唯一索引)✅
- 03 login 双查(schema/service/router)✅
- 04 admin username(schema/users_service/router+_resolve_username)✅
- 05 bootstrap username ✅
- 06 前端登录页 Segmented+跳转+auth.ts ✅
- 07 login 双查测试 ✅

## 设计一致性
实现与 design.md 一致,含 Design Grill 修正的 bootstrap username(D-005@V1)与 router.py 调用点(task-03/04)。

## 探针结果
- 未实现标记扫描:无 TODO/FIXME/HACK
- 关键词覆盖:username/account backend 6 文件 + frontend login/page.tsx+auth.ts ✅
- 测试覆盖:login 双查测试(test_login_by_email_or_username)✅
- decisions 闭环:D-001~D-005@V1 全下游覆盖(requirements+plan+tasks)✅

## 风险分级
**contract-required**(LoginRequest email→account + UserRead 加 username 是 API contract 变更)
- contract test:login 双查(email/username/大小写/防枚举 4 case)✅
- 非 integration-critical:不改 session 生命周期(契约表已声明)、无 daemon 跨进程新逻辑

## 测试证据
- 后端 pytest **145 passed**(auth+admin 全量含 login 双查)
- 后端 ruff **All checks passed**
- 前端 tsc --noEmit 通过、eslint **exit 0**

## Runtime Evidence
- login 双查:单元测试覆盖 email 路径 + username 路径 + 大小写不敏感 + 防枚举(不存在/错密码统一 401)
- ⚠️ 迁移实测(alembic upgrade)待 PG 环境:host 无 PG 连接、docker 未运行;迁移 SQL(split_part + ROW_NUMBER 去重 a/a2/a3 + 唯一索引)已代码审查,待 PG 环境实测回填与唯一性
- ⚠️ 浏览器实测待用户:Segmented 平台选择 + 两平台跳转

## NOTES(遗留)
1. 迁移实测待 PG 环境(SQL 已审查,host 受限)
2. 浏览器实测建议用户启动前端确认 Segmented + 跳转
3. execute worktree 隔离已跳过(主仓库直接实现,worktree+分支已清理)
4. 过程中发现并修复回归:前端 login 改动被并行 frontend-style-system 变更覆盖丢失,已基于新版(Card 样式)重新应用 account/Segmented/PLATFORM/跳转,tsc+eslint 复验通过
