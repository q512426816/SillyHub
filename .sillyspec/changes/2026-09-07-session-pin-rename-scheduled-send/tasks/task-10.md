---
id: task-10
title: 'regression-verify-backend-and-frontend'
title_zh: '回归验证（backend daemon/agent 模块测试 + frontend typecheck/lint + 既有测试零回归）'
author: 'qinyi'
created_at: 2026-09-07 23:32:39
priority: P0
depends_on: ['task-06', 'task-07', 'task-08', 'task-09']
blocks: []
requirement_ids: [FR-07]
decision_ids: []
allowed_paths:
  - frontend/src/lib/daemon.ts
  - backend/app/modules/daemon/router.py
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  全变更收口回归——按 local.yaml modules 映射跑 backend daemon/agent 两子模块测试与
  frontend typecheck/lint/既有测试，确认全绿或已知豁免内（FR-07 兼容与回归验收锚），
  记录结果供 verify 阶段引用。
implementation:
  - backend 回归——cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto（local.yaml daemon 模块命令，含 task-06 三新测试文件）；cd backend && uv run pytest app/modules/agent -q --no-cov -n auto（agent/model.py 改动波及面零回归）
  - frontend 回归——cd frontend && pnpm typecheck && pnpm lint；pnpm exec vitest run src/components/sessions/__tests__ src/lib（既有零回归范围，含 lib/daemon.test.ts）
  - 失败归因——对照 local.yaml known_failures 豁免清单逐条归因；已知失败（预存债/工具误判）记录在案不在本卡修，豁免外新失败回流对应 task 修复后重跑
  - 汇总回归证据（命令+通过数+每条豁免的归因）留档供 verify 阶段引用
acceptance:
  - backend daemon/agent 两模块测试全绿，或失败均落在 known_failures 豁免清单内
  - frontend typecheck 干净、lint 通过、session-list-panel 与 src/lib 既有测试零回归
  - 豁免外零新增失败，每条豁免均有归因记录（文件/原因/回流去向）
  - brownfield 兼容——未置顶/无定时消息时既有列表与输入行为与现状一致（回归用例佐证）
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto
  - cd backend && uv run pytest app/modules/agent -q --no-cov -n auto
  - cd frontend && pnpm typecheck && pnpm lint
  - cd frontend && pnpm exec vitest run src/components/sessions/__tests__ src/lib
constraints:
  - 无源码改动的回归卡——原则上不修代码，豁免外失败回流对应 task 修复后重跑（本卡只收证据）
  - 已知失败按 local.yaml known_failures 清单归因，不在本卡修预存债
  - 不缩小测试范围绕过失败（对齐 local.yaml modules 块精确子模块原则）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
