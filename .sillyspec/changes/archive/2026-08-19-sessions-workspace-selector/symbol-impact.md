---
author: WhaleFall
created_at: 2026-08-19T14:50:00
---

# 符号影响面报告 — sessions-workspace-selector

逐 task 扫描符号（函数签名、DTO、接口、响应体）变更：

| task | 符号变更 | 说明 |
|---|---|---|
| task-01 | 无 | 新增纯前端组件，不导出新符号给其他模块 |
| task-02 | 新增异常类 `DaemonSessionWorkspaceNotFound` | service.py 内部新增，继承 AppError，不改任何现有函数签名 |
| task-03 | 新增 state `workspaceId` + `NewSessionFormValues.workspaceId` | 内部组件 state；Values 接口新增 optional 字段（consumer=onCreated callback，是同组件内部，不跨模块） |
| task-04 | 无 | 纯测试文件，不改源码符号 |
| task-05 | 无 | 纯测试文件，不改源码符号 |
| task-06 | 无 | 纯测试文件，不改源码符号 |

结论：无跨模块签名级变更。task-02 新增异常类仅在 service.py 内部使用（router 层不直接 import，FastAPI 自动转为 404 响应），不构成外部 API 行为变更。
