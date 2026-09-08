---
id: task-17
title: '总验收——8 文件行数达标汇总 + 三端定向回归汇总 + 模块文档更新（SillyHub/modules/daemon.md、frontend_components.md、frontend_lib.md 与项目级 sillyhub-daemon.md 的文件结构段）'
title_zh: '总验收——8 文件行数达标汇总 + 三端定向回归汇总 + 模块文档更新（SillyHub/modules/daemon.md、frontend_components.md、frontend_lib.md 与项目级 sillyhub-daemon.md 的文件结构段）'
author: 'qinyi'
created_at: 2026-09-07 08:48:02
priority: P1
low_risk: true
depends_on: ['task-05', 'task-12', 'task-16']
blocks: []
requirement_ids: [FR-01, FR-04, FR-06]
decision_ids: [D-001@v1]
allowed_paths:
  - .sillyspec/docs/SillyHub/modules/daemon.md
  - .sillyspec/docs/SillyHub/modules/frontend_components.md
  - .sillyspec/docs/SillyHub/modules/frontend_lib.md
  - .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md
  - .sillyspec/changes/2026-09-07-arch-large-file-split/module-impact.md
  - .sillyspec/changes/2026-09-07-arch-large-file-split/verify-result.md
goal: >
  总验收（Wave 12）——汇总 8 文件行数达标与三端定向回归证据，核查在途文件零改动，更新四份模块文档并回填 module-impact 更新结果表。
implementation:
  - wc -l 汇总 8 个目标文件拆分后行数（daemon 2 + backend 4 + frontend 2），对照 D-005@v3 目标逐项判定
  - git diff --stat 核查 D-001 排除的 9 个在途路径（daemon 5 + backend 4）零改动
  - 汇总 task-05/task-12/task-16 三端定向回归与 openapi 零 diff 证据写入 verify-result.md
  - 回填 module-impact.md 更新结果表四行 pending 为 done
  - 更新四份模块文档文件结构段（backend daemon 四包化、session-panel 目录化、lib/daemon 目录化、daemon 两 god 文件包化）
acceptance:
  - module-impact.md 更新结果表无 pending 行
  - 四份模块文档文件结构段与拆分后实际目录一致
  - 在途 9 路径 git diff 为空，8 文件行数全部达标
  - verify-result.md 含三端定向测试全绿与类型检查通过证据
verify:
  - git diff --stat -- sillyhub-daemon/src/daemon.ts sillyhub-daemon/src/hub-client.ts sillyhub-daemon/src/config.ts sillyhub-daemon/src/protocol.ts sillyhub-daemon/src/sillyspec-manager.ts backend/app/modules/daemon/protocol.py backend/app/modules/daemon/runtime/service.py backend/app/modules/daemon/ws_hub.py backend/app/modules/daemon/lease/context.py
  - wc -l sillyhub-daemon/src/interactive/session-manager.ts sillyhub-daemon/src/task-runner.ts backend/app/modules/daemon/router/__init__.py backend/app/modules/daemon/session/service/__init__.py backend/app/modules/daemon/group/service/__init__.py backend/app/modules/daemon/run_sync/service/__init__.py frontend/src/components/daemon/session-panel/session-panel-page.tsx frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
  - grep -c pending .sillyspec/changes/2026-09-07-arch-large-file-split/module-impact.md
constraints:
  - 只改文档与汇总文件，不改任何代码与测试
  - 不重跑三端全量测试，引用 task-05/task-12/task-16 已有验收结果
  - 模块文档仅更新文件结构段与新模块清单，不重写整份模块卡
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
