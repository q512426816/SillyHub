---
author: flow-machine-draft
created_at: 2026-10-08T00:36:19.670Z
---
# 任务注册表（Tasks）— 2026-10-08-provider-update-models-none-guard

- [x] task-01: 写回归测试 test_explicit_null_models_is_noop（显式 models=None 不动原列表 + 非 None 列表仍整表替换双断言）——验证：修复前单跑该用例，应因 NOT NULL IntegrityError 挂掉（先红）✅ 实测先红（TypeError: updated.models 为 None——SQLite 下 JSON 绑定把 None 序列化成字符串 'null' 静默写坏行，见 design 机制修正）
- [x] task-02: service.update() 补 models 显式 None-pop（对齐 agent_kinds 既有防护位）——验证：同用例单跑转绿 ✅ 1 passed
- [x] task-03: 相关面回归——验证：pytest 跑 test_agent_kinds_multi.py 全文件绿（全量留 CI）✅ 7 passed + 顺带 test_llm_provider.py 41 passed + ruff/mypy 0 error
