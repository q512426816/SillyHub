---
author: qinyi
created_at: 2026-09-09 12:53:17
---

# 提案（Proposal）— 2026-09-09-sessions-visual-refresh

## 一句话

会话页（含群聊面板）完整视觉焕新：角色化气泡+头像、极光玻璃氛围、弥散阴影体系、深色主题层级修复——对齐现代 AI 聊天产品观感，简洁大气好用。

## 动机

- 用户三连反馈会话页"不够高级"：灰盒套灰盒、消息无角色感、深色主题层级糊、氛围元素（玻璃/极光）读了像没读。
- P0 止血（ql-20260909-009：气泡收窄+深色代码块+composer 阴影）已验证方向正确，本变更完成剩余主体。
- 设计基准为变更目录 `prototype-sessions-visual-refresh.html` v4（用户逐轮确认：v1 不够高级 → v2 六杠杆 → v3 玻璃可读性+删流光条 → v4 自审五项修正）。

## 范围

- 前端表现层：globals.css 主题 token、themes.ts dark 底色、`components/chat/` 新共享构件、单聊时间线/段视图、会话面板头、会话列表行、群聊面板、输入框 composer、dashboard 应用壳。
- 三主题（blue / ai-native / dark）一致生效。

## 不在范围内（Non-Goals）

- 不改交互逻辑/数据流/API/SSE/状态机；不做面板顶部渐变条或流光动画（D-008 用户否决）；不动移动端 /m/；不动 blue 主题底色；不重构群聊时间线归并/分页逻辑；P0 已落地内容不返工（D-001）。

## 决策依据

decisions.md D-001@v1~D-009@v1 全部当前版本决策为本提案边界与形态的权威依据（requirements.md 逐条引用）。
