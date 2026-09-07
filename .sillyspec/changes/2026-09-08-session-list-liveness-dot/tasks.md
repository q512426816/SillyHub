---
author: qinyi
created_at: 2026-09-08 00:20:00
---

# 任务清单（Tasks）

- [ ] task-01: use-session-liveness hook——取数（固定 all 槽 30s 轮询、map DESC 首胜）+ 客户端转移检测状态机 + localStorage 读写降级 (depends_on: —)
- [ ] task-02: SessionRow 行尾 antd Popover 小灯 + 组合渲染悬停卡 + 未读红点（selected 置真清除）+ props 链透传 (depends_on: task-01)
- [ ] task-03: 前端测试——session-list-panel 补用例（含 vi.mock @/lib/agent-logs）+ use-session-liveness 新用例 + tsc/既有零回归 (depends_on: task-01, task-02)
