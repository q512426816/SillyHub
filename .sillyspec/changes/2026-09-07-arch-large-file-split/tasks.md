---
author: qinyi
created_at: 2026-09-07 08:32:48
---
# 任务清单（Tasks）

> 骨架清单：任务名与边界，细节（allowed_paths/依赖/验收命令）由 plan 阶段展开写回本文件。

- [x] task-01: Wave1 前置对账——session-manager/task-runner 全量导出面与引用方符号清单（facade 保底基线）
- [x] task-02: Wave1 拆分 session-manager.ts → interactive/session-manager/ 13 子模块 + 瘦 facade（一次一簇、每簇定向测试）(depends_on: task-01)
- [x] task-03: Wave1 拆分 task-runner.ts → task-runner/ 8 子模块 + 瘦 facade (depends_on: task-01)
- [ ] task-04: Wave1 轻重构——payload-utils.ts（鸭子读取器统一）+ event-wire.ts（平行转换收敛）+ dialogResult 收敛（白名单 ①②⑥）(depends_on: task-02, task-03)
- [ ] task-05: Wave1 验收——daemon 定向测试全绿（session-manager/task-runner 相关子集）+ tsc --noEmit + 行数核查 (depends_on: task-04)
- [ ] task-06: Wave2 前置对账——import 语句 + patch 字符串目标两类清单生成（R-04 对账基线 + D-007 延迟解析白名单）(depends_on: task-05)
- [ ] task-07: Wave2 拆分 router.py → router/ 9 文件包（挂载顺序不变量 + 同形状路由保序对）(depends_on: task-06)
- [ ] task-08: Wave2 拆分 session/service.py → session/service/ 14 文件包（6 私有符号 + patch 命名空间规则）(depends_on: task-06)
- [ ] task-09: Wave2 拆分 group/service.py → group/service/ 10 文件包 (depends_on: task-06)
- [ ] task-10: Wave2 拆分 run_sync/service.py → run_sync/service/ 9 文件包 (depends_on: task-06)
- [ ] task-11: Wave2 轻重构——_background_tasks.py mixin + event_publish.py + attachment_pipeline.py（白名单 ③④⑤）(depends_on: task-08, task-09, task-10)
- [ ] task-12: Wave2 验收——backend 定向测试全绿（daemon/tests 相关子集）+ ruff + openapi.json 零 diff + 行数核查 (depends_on: task-07, task-11)
- [ ] task-13: Wave3 前置对账——session-panel 7 符号 + lib/daemon 全量导出面清单 (depends_on: task-12)
- [ ] task-14: Wave3 拆分 session-panel.tsx → session-panel/ 11 文件目录（index 7 符号再导出；page ≤3000 / dialog ≤2000 豁免）(depends_on: task-13)
- [ ] task-15: Wave3 拆分 lib/daemon.ts → lib/daemon/ 10 文件目录 (depends_on: task-13)
- [ ] task-16: Wave3 验收——frontend 定向测试全绿（components/daemon/__tests__ + lib/daemon mock 相关）+ tsc --noEmit + 行数核查 (depends_on: task-14, task-15)
- [ ] task-17: 总验收——8 文件行数达标汇总 + 三端定向回归汇总 + 模块文档更新（SillyHub/modules/daemon.md、frontend_components.md、frontend_lib.md 与项目级 sillyhub-daemon.md 的文件结构段）(depends_on: task-05, task-12, task-16)
