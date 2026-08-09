---
author: qinyi
created_at: 2026-08-09T13:10:53
---

# 任务清单（Tasks）— 安全凭据卫生

> 任务细节在 plan 阶段展开。本清单只列任务名与归属。

- [ ] task-01 前端：桌面登录页删密码明文缓存 + 默认回填（`(auth)/login/page.tsx`，FR-01/02/03/04）
- [ ] task-02 前端：移动登录页同步改法（`m/login/page.tsx`，FR-01/02/03/04）
- [ ] task-03 后端：config.py 加 bootstrap 弱口令 field_validator（FR-05，方案A，D-002）
- [ ] task-04 后端：新增 bootstrap 弱口令校验单测（`tests/modules/auth/test_bootstrap_password_strength.py`，FR-05）
- [ ] task-05 文档/deploy：清理 admin123（README、docs/security-audit 4 处、2 部署 skill，FR-06）
- [ ] task-06 deploy：改真实 deploy/.env 弱口令 + .env.example 注释（FR-06/07）
- [ ] task-07 验证：后端 pytest + ruff/mypy + 前端 lint + 手测 fail-fast 与 localStorage 无密码（见 design §11）
- [ ] task-08 收尾：CONCERNS.md 标记已解决 + 模块文档变更索引 + QUICKLOG 精修
