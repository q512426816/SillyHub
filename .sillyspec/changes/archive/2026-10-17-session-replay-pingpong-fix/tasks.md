---
author: flow-machine-draft
created_at: 2026-10-17T12:52:24.206Z
---
# 任务注册表（Tasks）— 2026-10-17-session-replay-pingpong-fix

- [x] task-01: storage 回放改为只回放与本地当前状态实际不同的字段，回放值与本地完全一致时不调用 setState（不产生 localStorage 写盘），切断乒乓环路
- [x] task-02: 真实跨标签同步语义保留：对方标签的 accessToken/refreshToken/user 真实变化仍正确回放到本页
- [x] task-03: 新增单测覆盖：同值回放跳过、异值回放生效、部分字段差异只回放差异字段
- [x] task-04: 既有 token-refresh 等相关测试不回归
