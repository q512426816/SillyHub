---
author: qinyi
created_at: 2026-09-09 12:53:17
---

# 任务清单（Tasks）— 2026-09-09-sessions-visual-refresh

细节在 plan 阶段展开；对应 Wave 见 design.md 总体方案。

## Wave 1 — token 层

- task-01 globals.css 新增共享 token（--border-soft / --row-active(-ring) / --shadow-glow / --glass(-heavy) / --aurora-*）**三主题分值写满**（:root 紫系 / blue 蓝系 / dark 青系，D-002@v2）+ --shadow-primary 三主题降重 + dark --color-bg/--background → zinc-950 等值（FR-02/FR-03/FR-06）
- task-02 themes.ts darkTheme.color.bg #18181b→#09090b + themes.test.ts 断言适配（FR-06）

## Wave 2 — 共享聊天构件

- task-03 components/chat/chat-message-avatar.tsx + 单测（FR-01，kind/size/name + avatar 图片入参优先 D-006@v2；**useAvatarSrc 自 group-member-avatar.tsx 平移到 components/chat/ 共用**，原文件改 import 不拷贝逻辑）
- task-04 components/chat/round-divider.tsx + 单测（**六态着色映射** D-010@v1）+ index.ts 桶导出（FR-04）

## Wave 3 — 单聊面板接入

- task-05 turn-segment-views.tsx TextSegmentView 接 agent 头像行（**仅对话视图生效**，「全部/进度」视图时间线原样式不动）；工具/思考行 43px 左缩进对齐（Grill G-02）
- task-06 turn-timeline.tsx 用户气泡/旧路径 agent 气泡接 ChatMessageAvatar；对话视图轮尾接 RoundDivider（FR-01/FR-04）
- task-07 session-panel-page.tsx 面板头面包屑降噪 + 玻璃化（FR-07）

## Wave 4 — 列表与应用壳

- task-08 session-list-panel.tsx 列表行两行化 + 引擎色点 + 选中态 token 化（FR-05）
- task-09 dashboard layout 壳挂极光背景 + 侧栏/列表列/面板玻璃化（FR-02）

## Wave 5 — 群聊 + composer

- task-10 group-chat-panel.tsx 消息行接 ChatMessageAvatar（**成员自定义头像图片保留**，无图回退成员名首字/分色；agent 成员挂渐变光环）+ hover/选中 token 化（FR-01 群聊侧，D-006@v2；含自定义头像回归用例）
- task-11 session-input-bar.tsx composer 聚焦环 3px/10% 柔化（FR-03 子项）

## 验收

- task-12 全量相关测试回归 + tsc/eslint + dev server 实拍效果图（R-01：会话页/首页/工作区三页 × ai-native/dark 双主题 + blue 主题会话页一张验证 R-07 零串紫）
