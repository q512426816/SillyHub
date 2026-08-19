---
schema_version: 1
doc_type: task
id: task-05
title: Add Runtime error subclasses
title_zh: 新增 Runtime 错误子类
author: qinyi
created_at: 2026-08-19T06:45:00+00:00
change_name: 2026-08-19-runtime-live-daemon-read
wave: 5
allowed_paths:
  - backend/app/modules/runtime/errors.py
goal: 建立 runtime 模块专属错误体系，避免暴露 Explorer 内部类名
implementation: 新建 8 个 Runtime* AppError 子类，映射 daemon 返回的 offline/timeout/forbidden/not_found/method_not_found/remote_error
acceptance: 每个错误类有独立 code、HTTP status、中文 message
verify: test_live_service.py 断言错误类型与 HTTP code
constraints: 错误文案不泄漏内部模块名；code 以 HTTP_ 开头
---

# task-05：新增 Runtime 错误子类
