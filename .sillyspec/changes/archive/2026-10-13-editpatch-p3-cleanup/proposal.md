---
author: flow-machine-draft
created_at: 2026-10-13T04:40:11.707Z
---
# 提案书（Proposal）— 2026-10-13-editpatch-p3-cleanup

## 动机

任务原话转写：收编 editpatch-fullchain 评审 P3：①daemon EDIT_PATCH_MAX_CHARS 按 UTF-16 字符计（64_000），CJK patch 字节数可超 64KB 仍附着——改按 UTF-8 字节计（Buffer.byteLength）；②agent-log-card 的 result.edit_patch → segment.editPatch → ToolCallPreview 接线无直接断言——补装配直连用例
成功标准：
- daemon edit_patch 上限按 UTF-8 字节判定，CJK 大 patch 超限不附着（新用例覆盖）
- agent-log-card 装配测试断言 edit_patch 直连透传到 ToolCallPreview（新用例覆盖）
- 相关 daemon/frontend 测试通过，既有行为零回归

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. daemon edit_patch 上限按 UTF-8 字节判定，CJK 大 patch 超限不附着（新用例覆盖）
2. agent-log-card 装配测试断言 edit_patch 直连透传到 ToolCallPreview（新用例覆盖）
3. 相关 daemon/frontend 测试通过，既有行为零回归

## 成功标准（可验证）

1. daemon edit_patch 上限按 UTF-8 字节判定，CJK 大 patch 超限不附着（新用例覆盖）
2. agent-log-card 装配测试断言 edit_patch 直连透传到 ToolCallPreview（新用例覆盖）
3. 相关 daemon/frontend 测试通过，既有行为零回归
