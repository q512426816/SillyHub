---
author: flow-machine-draft
created_at: 2026-10-13T15:10:14.439Z
---
# 任务注册表（Tasks）— 2026-10-13-change-reparse-autobind-remove

- [x] task-01: 移除 D-007 自动绑定代码——service.py 删 reparse created 调用点与 `_bind_change_to_session` 方法、docstring 更新，清理 model.py / binding.py 中对该方法的注释引用；验证：全仓 grep `_bind_change_to_session` 于 backend/app 零命中
- [x] task-02: 重写 test_change_session_binding.py（created 零 link / 重复 reparse 零 link / scoped 零 link / 已删方法守卫）+ test_spec_binding.py docstring 文案修正；验证：pytest change 模块绑定相关用例全绿
- [x] task-03: 同步 .sillyspec 文档——change.md 关键逻辑段与 _module-map.yaml reparse 注释去「自动绑定最近活跃会话」；验证：两文件 grep 该表述零命中
