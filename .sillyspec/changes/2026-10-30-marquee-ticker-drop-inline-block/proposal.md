---
author: flow-machine-draft
created_at: 2026-10-30T00:34:57.674Z
---
# 提案书（Proposal）— 2026-10-30-marquee-ticker-drop-inline-block

## 动机

任务原话转写：会话页对话tab底部实时进度跑马灯 ticker 元素（data-testid=marquee-ticker）class 去掉 inline-block，其余 class 不动。

成功标准：
- turn-live-marquee.tsx 中 marquee-ticker span 的 className 不再包含 inline-block，其余 class（sh-live-marquee-ticker whitespace-nowrap font-medium text-foreground）保持不变
- frontend 现有 turn-live-marquee 相关测试不回归

## 变更范围

按成功标准机械推导，共 2 条验收面：
1. turn-live-marquee.tsx 中 marquee-ticker span 的 className 不再包含 inline-block，其余 class（sh-live-marquee-ticker whitespace-nowrap font-medium text-foreground）保持不变
2. frontend 现有 turn-live-marquee 相关测试不回归

## 成功标准（可验证）

1. turn-live-marquee.tsx 中 marquee-ticker span 的 className 不再包含 inline-block，其余 class（sh-live-marquee-ticker whitespace-nowrap font-medium text-foreground）保持不变
2. frontend 现有 turn-live-marquee 相关测试不回归
