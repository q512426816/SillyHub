---
id: task-07
title: lint + tsc + vitest 全绿（Wave-5）
priority: P1
estimated_hours: 1
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06]
blocks: []
requirement_ids: [NFR-4]
decision_ids: []
allowed_paths: []
created_at: 2026-06-23T10:29:26+08:00
author: qinyi
---

# task-07: lint + tsc + vitest 全绿（Wave-5）

> 覆盖：NFR-4, SC-9/10
> 性质：验收任务（不写新代码），对应项目执行顺序中「跑测试 → 验收」环节
> 依赖：task-01~06 全部完成（helper 提取 / 弹窗组件 / active attach / page 精简 / 两个测试文件）

## 修改文件

本任务为验收任务，原则上无新增、无修改文件，仅执行验证命令。若发现错误需回溯修复，可能涉及的文件（按 task 归属）：

- task-01 helper 提取：`frontend/src/components/daemon/runtime-session-helpers.tsx`、`frontend/src/app/(dashboard)/runtimes/page.tsx`
- task-02/03 弹窗组件：`frontend/src/components/daemon/runtime-session-dialog.tsx`
- task-04 page 精简：`frontend/src/app/(dashboard)/runtimes/page.tsx`
- task-05 测试重写：`frontend/src/app/(dashboard)/runtimes/page.test.tsx`
- task-06 弹窗测试：`frontend/src/components/daemon/__tests__/runtime-session-dialog.test.tsx`

## 覆盖来源

- **NFR-4**：`pnpm lint` + `tsc --noEmit` 通过；vitest 全绿。
- **SC-9**：`page.test.tsx` 全绿 + 新增弹窗测试通过（task-05/06 已交付测试，本任务跑通即达成）。
- **SC-10**：`pnpm lint` + `tsc --noEmit` 通过（本任务直接验收）。

## 实现要求

所有命令在 `frontend/` 子项目目录下执行（local.yaml 明确根级无统一命令，需 cd 子项目）。命令优先级：local.yaml 已配置 → `pnpm lint` / `pnpm test`；类型检查用 `pnpm tsc --noEmit`（或 `npx tsc --noEmit`）。

按顺序执行三条命令，逐条确认全绿：

1. **类型检查**（SC-10 半）：
   ```bash
   cd frontend && pnpm tsc --noEmit
   ```
   通过判据：退出码 0，无 TS 报错（重点关注 helper 提取后的 import 路径、props 类型签名、`DaemonRuntimeRead | null` 联合类型收窄）。

2. **lint**（SC-10 半）：
   ```bash
   cd frontend && pnpm lint
   ```
   通过判据：退出码 0，next lint 无 error（warning 可接受但需记录）。重点排查：未使用变量 / import（helper 提取后 page.tsx 不再用的旧 import）、react-hooks 依赖数组、`@typescript-eslint/no-unused-vars`。

3. **测试**（SC-9）：
   ```bash
   cd frontend && pnpm test
   ```
   通过判据：vitest run 全绿，至少包含以下两个测试文件全部通过：
   - `page.test.tsx`（task-05 重写后的断言：弹窗打开 / active attach 可发送 / 无常驻会话区 / URL 恢复）
   - `runtime-session-dialog.test.tsx`（task-06 新增：弹窗渲染 / active attach 续聊 / ended 继续对话 / codex 只读 / 关闭清理无泄漏）

**发现错误时的回溯策略**：

- 类型 / import 路径错误 → 多半源自 task-01 helper 提取边界（命名导出遗漏、循环依赖）或 task-02/04 引用，回溯对应 task 修。
- lint 未使用变量 / 依赖数组 → 多半源自 task-04 page.tsx 移除常驻会话区后残留的旧 state / import，回溯 task-04 清理。
- 测试失败 → 按 task 归属回溯：`page.test.tsx` 失败回溯 task-04（实现）或 task-05（测试断言）；`runtime-session-dialog.test.tsx` 失败回溯 task-02/03（实现）或 task-06（测试）。
- 修复后重跑全部三条命令（不只跑单条），确保不引入回归。
- 修复点需在本任务文件末尾「修复记录」追加（task 编号 + 文件 + 问题 + 修法）。

## 完成标准

- [ ] `cd frontend && pnpm tsc --noEmit` 退出码 0
- [ ] `cd frontend && pnpm lint` 退出码 0
- [ ] `cd frontend && pnpm test` 全绿（含 `page.test.tsx` + `runtime-session-dialog.test.tsx`）
- [ ] SC-9 达成（测试全绿）
- [ ] SC-10 达成（lint + tsc 通过）
- [ ] NFR-4 达成
- [ ] 若有回溯修复，已记录于下方「修复记录」并重跑三命令

## 注意事项

- **必须 cd frontend**：local.yaml 明确根级无统一构建命令，frontend 用 pnpm；类型检查命令为 `pnpm tsc --noEmit`（非 `pnpm typecheck`，除非 package.json 另有 script，以 local.yaml 为准）。
- **命令顺序**：先 tsc 再 lint 再 test。tsc 最快暴露类型 / import 问题，lint 次之，test 最慢且依赖前两者隐含的类型正确性。逐条确认全绿再进下一条，便于定位。
- **本任务是验收闸门**：task-01~06 全部依赖完成（`depends_on`）后方可执行；任一前置 task 未完成则本任务阻塞。
- **不写新代码**：本任务本质是「跑测试 → 验收」环节，不新增 / 修改源码（除非验证中发现前置 task 的缺陷需回溯修复，此时修的是对应 task 的文件，不是本任务产出）。
- **pre-commit hook 联动**：项目根 git pre-commit 会跑 ruff（backend），claude PreToolUse 会对 `git commit*` 触发 mypy + frontend；本任务验收通过后若需提交，hook 亦会再跑一次前端检查，确保一致。

## 修复记录

（验证中发现错误并回溯修复时在此追加；无则留空。格式：`| 序号 | 来源 task | 文件 | 问题 | 修法 |`）
