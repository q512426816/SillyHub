---
author: flow-machine-draft
created_at: 2026-10-23T06:40:17.501Z
---
# 提案书（Proposal）— 2026-10-23-diff-dialog-pairing-fix

## 动机

任务原话转写：轮文件变更弹窗(turn-file-diff-dialog)在补丁行缺 tool_use_id 时走②回退配对:无主补丁按日志序塞给「路径命中目标文件的第一个未用编辑调用」——多文件编辑轮必然张冠李戴(2026-10-23 实证:会话 49c5c3ec run 63130ca1,点 task-runner.test.ts 行显示 design.md/requirements.md 的编辑内容,真补丁被挤掉)。修复:回退改「就近紧邻配对」——无主补丁只配它之前最近的未用编辑族调用(不跨其他 tool_call/tool_result 行),配不上诚实丢弃;配对后路径过滤照旧。

成功标准：
- 无 id 补丁按「紧邻其前的最近未用编辑族调用」配对,不再全局按序塞给路径命中的调用(实证场景:点 task-runner.test.ts 显示的必须是该文件自己的补丁)
- 并发交错(紧邻调用非其归属)时该补丁段诚实丢弃,弹窗少显示但不显示错误内容
- ①tool_use_id 精确配对路径行为不变(id 齐全时零回归)
- edit_patch 行 tool_use_id 缺失的数据面环节问题登记 docs/sillyspec 已知问题留档
- 触及面 vitest 全绿 + pnpm exec tsc --noEmit 零类型错误

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 无 id 补丁按「紧邻其前的最近未用编辑族调用」配对,不再全局按序塞给路径命中的调用(实证场景:点 task-runner.test.ts 显示的必须是该文件自己的补丁)
2. 并发交错(紧邻调用非其归属)时该补丁段诚实丢弃,弹窗少显示但不显示错误内容
3. ①tool_use_id 精确配对路径行为不变(id 齐全时零回归)
4. edit_patch 行 tool_use_id 缺失的数据面环节问题登记 docs/sillyspec 已知问题留档
5. 触及面 vitest 全绿 + pnpm exec tsc --noEmit 零类型错误

## 成功标准（可验证）

1. 无 id 补丁按「紧邻其前的最近未用编辑族调用」配对,不再全局按序塞给路径命中的调用(实证场景:点 task-runner.test.ts 显示的必须是该文件自己的补丁)
2. 并发交错(紧邻调用非其归属)时该补丁段诚实丢弃,弹窗少显示但不显示错误内容
3. ①tool_use_id 精确配对路径行为不变(id 齐全时零回归)
4. edit_patch 行 tool_use_id 缺失的数据面环节问题登记 docs/sillyspec 已知问题留档
5. 触及面 vitest 全绿 + pnpm exec tsc --noEmit 零类型错误
