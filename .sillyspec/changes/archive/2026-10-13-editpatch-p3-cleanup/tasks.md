---
author: flow-machine-draft
created_at: 2026-10-13T04:40:11.707Z
---
# 任务注册表（Tasks）— 2026-10-13-editpatch-p3-cleanup

- [x] task-01: daemon edit_patch 上限按 UTF-8 字节判定，CJK 大 patch 超限不附着（新用例覆盖）。验证：新用例先红（30_000 CJK 字符=90_000 字节、字符计误附着，parse-claude-code 1 failed）→ 常量改名 EDIT_PATCH_MAX_BYTES + Buffer.byteLength(json,'utf8') 判定 → parse-claude-code 27/27 绿（12:46）
- [x] task-02: agent-log-card 装配测试断言 edit_patch 直连透传到 ToolCallPreview（新用例覆盖）。验证：新用例直接绿（P3 是缺断言非缺接线，真实渲染路径 Write/Edit 卡出变更对比 diff + 红删行底断言；agent-log-card 21/21，12:47）
- [x] task-03: 相关 daemon/frontend 测试通过，既有行为零回归。验证：daemon agent-log 全套 208/208 + typecheck exit=0（12:48）；frontend agent-log-card + agent-log + tool-args-detail 212/212（12:48）
