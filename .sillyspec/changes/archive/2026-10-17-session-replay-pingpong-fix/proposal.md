---
author: flow-machine-draft
created_at: 2026-10-17T12:52:24.206Z
---
# 提案书（Proposal）— 2026-10-17-session-replay-pingpong-fix

## 动机

任务原话转写：动机：生产环境后端日志 HTTP_401_AUTH_TOKEN_EXPIRED 每秒约10条持续刷屏（单日35万+，nginx 实证来自 Chrome 两个变更详情页标签、仅打 /api/auth/me、refresh 从未被调用），根因为 session store 的跨标签 storage 回放与 zustand persist「每次 setState 都写 localStorage」叠加：两个标签各持不同已过期 access token 时形成 A写→B回放→B写→A回放 的无限乒乓，且 accessToken 字符串在 X↔Y 间翻转反复重触发 (dashboard)/layout.tsx 的 fetchMe effect；/api/auth/* 按设计排除在 401 自动续期外，循环永不自愈（session.ts 模块注释「回放不会再写 localStorage 无回环」的断言与 zustand persist 实际行为不符）。
成功标准：
- storage 回放改为只回放与本地当前状态实际不同的字段，回放值与本地完全一致时不调用 setState（不产生 localStorage 写盘），切断乒乓环路
- 真实跨标签同步语义保留：对方标签的 accessToken/refreshToken/user 真实变化仍正确回放到本页
- 新增单测覆盖：同值回放跳过、异值回放生效、部分字段差异只回放差异字段
- 既有 token-refresh 等相关测试不回归

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. storage 回放改为只回放与本地当前状态实际不同的字段，回放值与本地完全一致时不调用 setState（不产生 localStorage 写盘），切断乒乓环路
2. 真实跨标签同步语义保留：对方标签的 accessToken/refreshToken/user 真实变化仍正确回放到本页
3. 新增单测覆盖：同值回放跳过、异值回放生效、部分字段差异只回放差异字段
4. 既有 token-refresh 等相关测试不回归

## 成功标准（可验证）

1. storage 回放改为只回放与本地当前状态实际不同的字段，回放值与本地完全一致时不调用 setState（不产生 localStorage 写盘），切断乒乓环路
2. 真实跨标签同步语义保留：对方标签的 accessToken/refreshToken/user 真实变化仍正确回放到本页
3. 新增单测覆盖：同值回放跳过、异值回放生效、部分字段差异只回放差异字段
4. 既有 token-refresh 等相关测试不回归
