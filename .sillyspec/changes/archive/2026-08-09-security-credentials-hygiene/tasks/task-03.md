---
id: task-03
title: 后端 config.py 加 bootstrap 弱口令 field_validator
title_zh: config 层 fail-fast 拒绝 bootstrap 弱口令
author: qinyi
created_at: 2026-08-09 13:18:35
priority: P0
depends_on: []
blocks: [task-04, task-07]
requirement_ids: [FR-05]
decision_ids: [D-002@v1, D-004@v1]
allowed_paths:
  - backend/app/core/config.py
goal: >
  config 加 field_validator 在配置加载期 fail-fast 拒绝常见弱口令与登录名相同口令，复用 config.py 现有 field_validator 同款模式。
implementation:
  - 实现首步验证 pydantic v2 field_validator 的 info.data 能否在 password validator 内取到 email（字段顺序 email 在 password 前 理论可取）
  - 若取不到则降级用 model_validator mode after 做兜底（此时全部字段就绪）
  - 新增模块级 _WEAK_BOOTSTRAP_PASSWORDS frozenset 含 admin123 admin1234 admin@123 password password123 passwd123 12345678 123456789 1234567890 qwerty123 letmein123 welcome123
  - 加 field_validator platform_bootstrap_admin_password None 放行 表内命中抛 ValueError 提示改强口令 与 email 本地部分相同抛 ValueError
  - import 已有 Field field_validator（config.py:16 已 import）与 ValidationInfo
acceptance:
  - PLATFORM_BOOTSTRAP_ADMIN_PASSWORD=admin123 启动 Settings 实例化抛 ValidationError
  - 表内所有弱口令同被拒
  - 口令与 email 本地部分相同被拒
  - 强口令正常启动 None 放行（不建号）
  - 现有 Settings 测试零回归
verify:
  - cd backend && uv run python -c "from app.core.config import Settings" 确认 import 无误
  - cd backend && uv run ruff check app/core/config.py
  - cd backend && uv run mypy app/core/config.py
constraints:
  - 仅作用于 platform_bootstrap_admin_password 配置项（D-004 已有 DB admin 不触发）
  - 不改 bootstrap service.py:362 的已存在不更新密码语义
  - 不改其它配置项 不加新依赖
  - validator 失败信息用中文提示
related_tests: []
---

# task-03 config 弱口令 validator

详见 frontmatter。对照 design.md §6.2、decisions D-002/D-004。R-01（info.data 字段顺序）实现首步验证，不通过用 model_validator 兜底。
