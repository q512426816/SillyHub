---
author: flow-machine-draft
created_at: 2026-10-09T14:58:49.787Z
---
# 任务注册表（Tasks）— 2026-10-09-ws-create-spec-default-collapse

- [x] task-01: 桌面端 workspace-scan-dialog.tsx：specStrategy 默认值改 repo-native，三选项提为模块级常量（去「默认」字样）——验证：组件编译通过，新常量被摘要行与单选列表共用
- [x] task-02: 桌面端 spec 区块收起/展开交互：specExpanded state 默认 false，收起态渲染摘要行+「更多选项」+⚠警示（repo-native 时），展开态条件渲染三单选+「收起」——验证：tsc 无错，DOM 条件渲染（非 CSS 隐藏）
- [x] task-03: 移动端 m/workspaces/page.tsx：specStrategy 默认值与 reset() 改 repo-native，SPEC_STRATEGY_OPTIONS 文案去「默认」字样——验证：tsc 无错
- [x] task-04: 移动端 WorkspaceCreateSheet 同款收起/展开交互（specExpanded + 摘要行 + 更多选项按钮）——验证：tsc 无错
- [ ] task-05: 桌面端测试 workspace-scan-dialog.test.tsx 新增用例：默认收起仅摘要行+前两选项不在 DOM+⚠ 可见、直接创建提交体带 repo-native、展开三选项可切换再收起选中值不变+切换后提交体随选中值——验证：pnpm vitest run 该文件全绿
- [ ] task-06: 移动端测试 page.m-workspaces.test.tsx 新增用例：默认 repo-native 提交体携带+收起态前两选项不在 DOM+⚠ 可见+展开文案断言——验证：pnpm vitest run 该文件全绿
- [ ] task-07: 回归验证：跑两端上述两个测试文件全量用例确认无既有用例挂（不跑全仓测试）——验证：两文件 vitest exit 0
