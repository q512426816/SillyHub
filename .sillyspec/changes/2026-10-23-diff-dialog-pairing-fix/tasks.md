---
author: flow-machine-draft
created_at: 2026-10-23T06:40:17.501Z
---
# 任务注册表（Tasks）— 2026-10-23-diff-dialog-pairing-fix

- [x] task-01: 无 id 补丁按「紧邻其前的最近未用编辑族调用」配对,不再全局按序塞给路径命中的调用(实证场景:点 task-runner.test.ts 显示的必须是该文件自己的补丁)
- [x] task-02: 并发交错(紧邻调用非其归属)时该补丁段诚实丢弃,弹窗少显示但不显示错误内容
- [x] task-03: ①tool_use_id 精确配对路径行为不变(id 齐全时零回归)
- [x] task-04: edit_patch 行 tool_use_id 缺失的数据面环节问题登记 docs/sillyspec 已知问题留档
- [x] task-05: 触及面 vitest 全绿 + pnpm exec tsc --noEmit 零类型错误
