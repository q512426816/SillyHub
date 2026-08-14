---
author: qinyi
created_at: 2026-08-14 14:05:38
---

# 任务清单（Tasks）

- [ ] task-01: workflow/model.py 定义审计 action 常量 + AUDIT_PLACEHOLDER_ID（5 常量，不含 _DELETE）
- [ ] task-02: main.py lifespan 挂载 register_audit_hooks（幂等验证）
- [ ] task-03: auth/service.py login 三分支手工审计（成功真实 id / 失败禁登占位 + raise 前 commit）+ 登录审计测试
- [ ] task-04: settings/router.py upsert 两处 per-key 手工审计 + settings 审计测试
- [ ] task-05: audit_hooks 生效用例（有 ctx/无 ctx/不递归）+ 全量 backend 回归
