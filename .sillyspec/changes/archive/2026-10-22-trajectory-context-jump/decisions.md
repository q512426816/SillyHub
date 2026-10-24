---
author: flow-machine-draft
created_at: 2026-10-24T00:06:14.594Z
---
# 决策记录（Decisions）— 2026-10-22-trajectory-context-jump

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：风险：`scrollIntoView` effect 在流式更新（新行追加）时可能把用户正在阅读的位置拉走——限定为「selectedRowId 变化时」触发（非滚动容器内容变化），与旧实现同口径。放弃的方案：让 TurnCatalog 直接操作轨迹 DOM（跨组件 querySelector）——耦合 DOM 结构且绕过选中状态机；放弃 imperative ref 暴露滚动方法——受控信号 + 选中 effect 已够用，少一条命令式通道。
