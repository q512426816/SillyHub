---
author: qinyi
created_at: 2026-09-07 08:45:59
change: 2026-09-07-arch-large-file-split
---

# 模块影响分析（Module Impact）— 三端会话域大文件架构拆分

> 首版生成于 plan 阶段（审查通过后）。execute/verify 阶段按实际代码变更回填「更新结果」；archive 阶段终审。

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend（daemon 模块，SillyHub/modules/daemon.md） | 修改 | router.py/session/group/run_sync 四个 service 文件目录化为同名包；新增 _background_tasks.py、event_publish.py、attachment_pipeline.py 三个共享模块；83 端点按域拆 9 文件；patch 命名空间规则（D-007）落地。对外 API/schema 零变化（openapi 零 diff 验收） |
| frontend（components 域，SillyHub/modules/frontend_components.md） | 修改 | components/daemon/session-panel.tsx（6620 行）拆为 session-panel/ 目录 11 文件；7 符号再导出保持导出面；page ≤3000 / dialog ≤2000 行数豁免 |
| frontend（lib 域，SillyHub/modules/frontend_lib.md） | 修改 | lib/daemon.ts（4090 行）拆为 lib/daemon/ 目录 10 文件；index 全量再导出，140 条 import 与 55 处 vi.mock 零改动 |
| sillyhub-daemon（项目级 modules/sillyhub-daemon.md） | 修改 | interactive/session-manager.ts（5438）拆 13 子模块+瘦 facade；task-runner.ts（3426）拆 8 子模块+瘦 facade；新增 src/payload-utils.ts、src/event-wire.ts 与 3 个定向测试文件 |

## 未匹配文件

无。全部变更文件均落入 backend/**、frontend/**、sillyhub-daemon/** 三个已注册模块路径。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `SillyHub/modules/daemon.md` | 更新 backend daemon 模块卡（四包化结构 + 三个共享模块，task-17） | pending |
| `SillyHub/modules/frontend_components.md` | 更新前端组件模块卡（session-panel 目录化，task-17） | pending |
| `SillyHub/modules/frontend_lib.md` | 更新前端 lib 模块卡（lib/daemon 目录化，task-17） | pending |
| `multi-agent-platform/modules/sillyhub-daemon.md` | 更新 daemon 模块卡（两 god 文件包化结构，task-17） | pending |
| `_module-map.yaml` | 无变化（未增删模块，路径映射不变） | skipped |
