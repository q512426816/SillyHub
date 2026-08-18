---
author: qinyi
created_at: 2026-08-18 14:55:00
---

# 符号影响面扫描结论

| task | 变更类型 | 受影响调用点 | 是否在 allowed_paths 内 | 结论 |
| --- | --- | --- | --- | --- |
| task-01 | 无签名级变更 | AgentSession(...) 构造在 start_scan_dispatch 内部 | 是 | service.py 内补传字段，无外部调用点 |
| task-02 | 函数返回结构变更 | scan_generate 调用点：workspace/router.py、测试 | 是 | 调用点均在 allowed_paths |
| task-03 | DTO 字段新增 | AgentSessionListItem 组装点：agent/router.py、change/router.py | 是 | 组装点均在 allowed_paths |
| task-04 | 类型文件重生成 | api-types.ts / openapi.json / daemon.ts | 是 | 仅类型定义，无运行时调用点 |
| task-05 | 无签名级变更 | workspace-config-card.tsx 内部事件处理 | 是 | 组件行为变更 |
| task-06 | 无签名级变更 | workspace-session-section.tsx 内部 URL 参数读取 | 是 | 组件行为变更 |
| task-07 | 无签名级变更 | session-list-layout.tsx / workspace-session-section.tsx 内部 | 是 | UI 徽标渲染 |
| task-08 | 文件删除 | agent 页面、导航、菜单、use-agent-runs | 是 | 删除文件与引用清理 |
| task-09 | 无签名级变更 | 测试文件断言调整 | 是 | 测试适配 |
| task-10 | 无源码变更 | 仅验证命令 | 是 | 全量验证 |
