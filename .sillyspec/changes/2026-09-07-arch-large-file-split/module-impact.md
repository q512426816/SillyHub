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
| backend（daemon 模块，SillyHub/modules/daemon.md） | 修改 | router.py/session/group/run_sync 四个 service 文件目录化为同名包；新增 _background_tasks.py、event_publish.py、attachment_pipeline.py 三个共享模块；83 端点按域拆 13 文件包（D-008@v2 execute 期 9→13 细化）；patch 命名空间规则（D-007）落地。对外 API/schema 零变化（openapi 零 diff 验收） |
| frontend（components 域，SillyHub/modules/frontend_components.md） | 修改 | components/daemon/session-panel.tsx（6620 行）拆为 session-panel/ 目录 12 文件（D-012 execute 期 11→12 细化）；7 符号再导出保持导出面；page ≤3000 / dialog ≤2000 行数豁免 |
| frontend（lib 域，SillyHub/modules/frontend_lib.md） | 修改 | lib/daemon.ts（4111 行，D-010 merge 后基线）拆为 lib/daemon/ 目录 14 文件（D-011 execute 期 10→14 细化）；index 全量再导出（sse-internals 私有不进 index），140 条 import 与 55 处 vi.mock 零改动 |
| sillyhub-daemon（项目级 modules/sillyhub-daemon.md） | 修改 | interactive/session-manager.ts（5438）拆 13 子模块+瘦 facade；task-runner.ts（3426）拆 8 子模块+瘦 facade；新增 src/payload-utils.ts、src/event-wire.ts 与 3 个定向测试文件 |

## 未匹配文件

无。全部变更文件均落入 backend/**、frontend/**、sillyhub-daemon/** 三个已注册模块路径。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `SillyHub/modules/daemon.md` | 文末新增「文件结构更新（2026-09-07-arch-large-file-split）」节：backend 侧 router/ 13 文件包、session/service/ 14、group/service/ 10、run_sync/service/ 9 文件包 + _background_tasks/event_publish/attachment_pipeline 三共享模块 + D-007 patch 兼容规则（文档无既有 backend 结构段，按追加节方式落地，task-17） | done |
| `SillyHub/modules/frontend_components.md` | 文末新增「文件结构更新（2026-09-07-arch-large-file-split）」节：session-panel/ 12 文件目录清单（page 2967≤3000 / dialog 1818≤2000 双豁免，D-012），task-17 | done |
| `SillyHub/modules/frontend_lib.md` | 文末新增「文件结构更新（2026-09-07-arch-large-file-split）」节：lib/daemon/ 14 文件目录清单（sse-internals 私有不进 index，188 导出面零漂移，D-011），task-17 | done |
| `multi-agent-platform/modules/sillyhub-daemon.md` | 契约摘要「Agent 接入」段与关键逻辑「本地能力」段精准更新（session-manager 1965 行 facade+13 模块包 / task-runner 1660 行 facade+8 模块包）+ 文末新增「文件结构更新（2026-09-07-arch-large-file-split）」节（含 payload-utils.ts/event-wire.ts 新增），task-17 | done |
| `_module-map.yaml` | 无变化（未增删模块，路径映射不变） | skipped |
