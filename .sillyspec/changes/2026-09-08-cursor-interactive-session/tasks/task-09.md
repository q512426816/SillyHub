---
id: task-09
title: '静态检查与相关测试（typecheck×2 + provider-registry/cursor-events/cursor-driver/caps-alignment/agent-log normalize）'
title_zh: '静态检查与相关测试（typecheck×2 + provider-registry/cursor-events/cursor-driver/caps-alignment/agent-log normalize）'
author: 'qinyi'
created_at: 2026-09-08 13:00:34
priority: P0
task_type: verification
depends_on: ['task-05', 'task-06', 'task-07', 'task-08']
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - sillyhub-daemon/package.json
  - frontend/package.json
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  全部代码任务（task-03~task-08）完成后的静态收口（FR-06 全局验收第 1/2 条）：daemon
  与 frontend 双 typecheck 零错 + 仅本变更相关测试全绿（provider-registry /
  cursor-events / cursor-driver / caps-alignment / agent-log normalize /
  pre-session-picker），全量测试留 CI（CLAUDE.md 规则 0）。
implementation:
  - 双 typecheck：pnpm -C sillyhub-daemon run typecheck 与 pnpm -C frontend run typecheck（InteractiveProvider 联合自动扩展 / 前端镜像表与 PROVIDER_META 类型错误在此暴露）
  - daemon 相关测试：cd sillyhub-daemon && pnpm exec vitest run tests/interactive/provider-registry.test.ts tests/interactive/cursor-events.test.ts tests/interactive/cursor-driver.test.ts（键集合 ['claude','codex','cursor','pi'] + 实例化/family 反查 + golden 逐字段 + 生命周期/interrupt/envelope-only/E3/E5）
  - backend 相关测试：cd backend && uv run pytest app/modules/agent/tests/test_provider_caps_alignment.py -q（caps 三端对齐四用例，EXPECTED_PROVIDERS 已含 cursor——D-004@v1 守护）
  - frontend 相关测试：cd frontend && pnpm exec vitest run src/components/agent-log/__tests__/normalize.test.ts src/components/agent-log/__tests__/normalize-dual-path.test.ts src/components/sessions/__tests__/pre-session-picker.test.tsx（normalize 双轨不回归 + 引擎白名单同步）
  - 失败处置：失败回 task-03~task-08 对应实现任务修后复跑；allowed_paths 两个 package.json 仅为 typecheck/test 命令执行涉及的配置占位（纯验证任务不改源码，target_files 留 []）
acceptance:
  - 双 typecheck 零错误退出（sillyhub-daemon 与 frontend 各 exit 0）
  - daemon 三测试文件全绿（provider-registry 键集合断言 + cursor-events golden + cursor-driver 生命周期）
  - backend test_provider_caps_alignment.py 四用例全绿（三端逐键一致，无 skip 掩盖）
  - frontend agent-log normalize 两测试与 pre-session-picker 测试全绿（既有断言无回归）
  - 失败项全部归因处置（回实现任务修后复跑全绿），无未处置失败
verify:
  - pnpm -C sillyhub-daemon run typecheck
  - pnpm -C frontend run typecheck
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/provider-registry.test.ts tests/interactive/cursor-events.test.ts tests/interactive/cursor-driver.test.ts
  - cd backend && uv run pytest app/modules/agent/tests/test_provider_caps_alignment.py -q
  - cd frontend && pnpm exec vitest run src/components/agent-log/__tests__/normalize.test.ts src/components/agent-log/__tests__/normalize-dual-path.test.ts src/components/sessions/__tests__/pre-session-picker.test.tsx
constraints:
  - 禁止跑全量测试（backend/frontend/daemon 全量留 CI——CLAUDE.md 规则 0），只跑列出的相关测试
  - 纯验证任务不改源码；非测试逻辑错误禁止改测试迁就（CLAUDE.md 规则 9），失败回 task-03~task-08 对应任务修
  - 不新增测试（新增测试属 task-03/04/05 交付物，本任务只执行验证）；package.json 占位路径不实际修改内容
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
