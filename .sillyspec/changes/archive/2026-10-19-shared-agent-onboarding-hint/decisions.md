---
author: flow-machine-draft
created_at: 2026-10-19T02:17:13.938Z
---
# 决策记录（Decisions）— 2026-10-19-shared-agent-onboarding-hint

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：把「机器数据加载中」误判为「无机器」而错误默认选中——以 `data != null` 守卫消除（loading/error 均 undefined → 门控 false）。 试过放弃的方案：①复用 `machines` prop 判定——无 loading 语义有误判窗口，且依赖门户传参形态，放弃；②把引导提示塞进 SessionConfigBar 内部——该组件是会话内配置面（真会话/预会话共用），预会话引导属页面语义，改共享组件还会扩大既有测试面，放弃。
