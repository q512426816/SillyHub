# 测试对账记录 — 2026-10-27-sessions-total-and-status-filter

task-07（相关测试全跑 + lint 触及文件无新增错误）实测记录，2026-10-27 13:24 本机：

| 面 | 命令 | 结果 |
| --- | --- | --- |
| backend 列表端点 | `.venv/Scripts/python.exe -m pytest app/modules/daemon/tests/test_session_history.py` | 20 passed（含新增 3 用例：status_counts 超上限口径 / status_group 三态命中 / 互斥 422；既有 17 用例零回归） |
| frontend 手机端组件 | `pnpm vitest run src/components/mobile/mobile-session-list.test.tsx` | 19 passed（含新增 4 用例：统计行+四 chips 服务端计数 / 切档参数与计数不漂移 / 默认 10∪在线全显+显示全部；菜单/群分区既有用例零回归） |
| frontend PC 面板 | `pnpm vitest run src/components/sessions/__tests__/session-list-panel.test.tsx` | 119 passed（断言规格化对齐 2 处：50 截断→10∪在线全显、「活跃」→「在线」） |
| 类型检查 | `pnpm exec tsc --noEmit`（frontend） | 0 错误 |
| lint | `eslint` 触及 5 文件 | 0 errors（3 warnings 为预存） |
| backend 格式/lint | ruff format + ruff check（pre-commit 已跑） | Passed |

并行会话竞态记录：执行中前端未提交改动曾被并行 stash/restore 窗口瞬时回滚（观测假象，
memory「共享仓并行竞态收口三坑」同款），实际改动幸存；session-lists.ts 出现恢复+重加叠加
的重复定义，已去重（提交 0381eaece 含此修复）。69cc0aa65 提交时误将并行会话 staged 的
2026-10-28-bg-task-status-report 文档一并带入（内容无损，提交边界混杂，如实留痕）。
