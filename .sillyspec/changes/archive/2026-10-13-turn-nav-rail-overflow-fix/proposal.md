---
author: flow-machine-draft
created_at: 2026-10-13T06:32:14.176Z
---
# 提案书（Proposal）— 2026-10-13-turn-nav-rail-overflow-fix

## 动机

任务原话转写：会话页轮次导航窄轨在轮次很多时溢出面板错乱:turn-nav-rail 容器 shrink-0 导致刻度轨不随面板高度收缩,长会话刻度叠到输入区/底部配置条上,nav 的 overflow-y-auto 滚动永不生效(截图实证 53 轮)。依据:frontend/src/components/sessions/turn-nav-list.tsx:282/310 与 session-panel-page.tsx:4959 挂载链,设计意图参照 turn-catalog.tsx 头注(超出回落顶对齐+轨内滚动+隐藏滚动条)。
成功标准:
- 轮次很多(内容高超过面板高)时窄轨刻度不再溢出面板,超出部分在轨内滚动(turn-nav-rail 去掉 shrink-0,nav flex-1+overflow-y-auto 真正生效)
- 轨内滚动不显示滚动条(与 turn-catalog 同款 scrollbar-width:none + webkit hidden)
- 少量轮次时形态不变(44px 窄轨+把手+居中刻度,浮层行为不受影响)
- turn-nav-list 单测补齐布局契约断言(rail 无 shrink-0、nav 可滚动+滚动条隐藏),既有测试全绿

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 轮次很多(内容高超过面板高)时窄轨刻度不再溢出面板,超出部分在轨内滚动(turn-nav-rail 去掉 shrink-0,nav flex-1+overflow-y-auto 真正生效)
2. 轨内滚动不显示滚动条(与 turn-catalog 同款 scrollbar-width:none + webkit hidden)
3. 少量轮次时形态不变(44px 窄轨+把手+居中刻度,浮层行为不受影响)
4. turn-nav-list 单测补齐布局契约断言(rail 无 shrink-0、nav 可滚动+滚动条隐藏),既有测试全绿

## 成功标准（可验证）

1. 轮次很多(内容高超过面板高)时窄轨刻度不再溢出面板,超出部分在轨内滚动(turn-nav-rail 去掉 shrink-0,nav flex-1+overflow-y-auto 真正生效)
2. 轨内滚动不显示滚动条(与 turn-catalog 同款 scrollbar-width:none + webkit hidden)
3. 少量轮次时形态不变(44px 窄轨+把手+居中刻度,浮层行为不受影响)
4. turn-nav-list 单测补齐布局契约断言(rail 无 shrink-0、nav 可滚动+滚动条隐藏),既有测试全绿
