---
author: qinyi
created_at: 2026-10-16 17:15:00
---
# 视觉证据（Visual Evidence）

**本变更无 UI 面变化——视觉门豁免（跳过档）。**

- 依据：设计阶段原型分级判定为「跳过」——本变更仅含后端 auth 服务逻辑（族级吊销/宽限窗/config）与前端 lib 层逻辑（token-refresh 状态码分流/注释），无新增页面、无布局变化、无组件级视觉变化（design.md「自审」节原型分级条目；无需渲染对照）。
- 用户裁决留痕：设计确认轮（brainstorm step 5，AskUserQuestion）用户确认「确认，按此推进」，原型跳过档随设计一并获批。
- 可运行验证替代：行为正确性由前后端测试覆盖（后端 298 passed 模块回归 / 前端 token-refresh 14 passed），非视觉面。
