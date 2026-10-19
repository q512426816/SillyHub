---
author: flow-machine-draft
created_at: 2026-10-19T05:48:31.294Z
---
# 任务注册表（Tasks）— 2026-10-19-preview-card-empty-turn-fix

- [x] task-01: preview-merge.ts 新增 isContentlessTerminalItem（started_at 空 + error_code 空 + 摘要双空 + previewTurnStatusOf 终态 completed/killed）并在归并循环加前置分支：命中透传盖 seq、未命中跳过；同步文件头归并规则注释。验证：既有 preview-merge 单测全绿 + 新用例红→绿
- [x] task-02: session-panel-page.tsx handleExpandPreview 对 empty 结果补 notify.warning("该轮无对话内容")，failed 语义与幂等/在飞去重不变。验证：集成测试真零正文轮用例断言轻提示
- [x] task-03: preview-merge.test.ts 新增「无内容终态轮」describe 五用例（命中透传盖章/未命中跳过/error_code 轮仍出卡/running 轮仍出卡/started_at 有值零摘要轮仍出卡），outlineItem fixture 默认补 started_at 对齐真实契约。验证：vitest 该文件全绿
- [x] task-04: session-preview-integration.test.tsx 新增「纯切换轮（started_at 空）不出预览卡、渲染孤儿配置行」用例 + 真零正文轮用例补 notify.warning 断言（mock @/lib/errors useNotify）。验证：vitest 该文件全绿
- [x] task-05: 回归面验证：preview-merge.test.ts / turn-preview-card.test.tsx / session-preview-integration.test.tsx 三文件全量通过零回归。验证：vitest 三文件一次跑绿
- [x] task-06: 真机验收追加——handleJumpToTurn 对 isContentlessTerminalItem 命中条目早退（不发请求直接定位配置行+记幂等）；三处固定文案 notify.error→notify.warning（直达零日志/回退到头/展开失败，消灭「操作失败」吞文案）；prefetchNearbyTurns 跳过无内容邻居；preview-merge 导出 isContentlessTerminalItem。验证：单测+集成全绿
- [x] task-07: 集成测试补两用例：静默轮导航刻度点击无 toast 无请求且配置行定位；真缺失日志轮（started_at 有值查回 0 条）报原文 warning 而非「操作失败」。验证：vitest 集成文件全绿
- [x] task-08: 追加回归面：三测试文件全量重跑零回归 + tsc 干净。验证：一次跑绿
