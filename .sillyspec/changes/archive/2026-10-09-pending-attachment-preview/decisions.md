---
author: flow-machine-draft
created_at: 2026-10-09T03:15:48.657Z
---
# 决策记录（Decisions）— 2026-10-09-pending-attachment-preview

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：测试面——多处既有 harness 以工厂 mock `@/lib/api/session-attachments`，缺新用到的 `fetchAttachmentBlob` 导出时组件 import 可能拿到 undefined；本变更只在实际点击预览时调用该函数，且对涉及的 mock 顺手补齐该导出。放弃的方案：给 chip 整体包 `<button>` 再给 X `stopPropagation`——嵌套按钮非法 HTML 且事件冒泡补丁脆弱，改为文件名区与 X 两个独立兄弟按钮，无冒泡依赖。
