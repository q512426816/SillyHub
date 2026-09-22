---
id: task-05
title: '前端白名单派生——provider-caps.ts 改生成产物含 PROVIDER_SWITCH_ENGINES 派生导出（消费点 import 不变）'
title_zh: '前端白名单派生——provider-caps.ts 改生成产物含 PROVIDER_SWITCH_ENGINES 派生导出（消费点 import 不变）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-12 00:00:07
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/lib/provider-caps.ts
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  前端 provider-caps.ts 定形为生成产物并退役手写 PROVIDER_SWITCH_ENGINES 白名单——改为从
  PROVIDER_CAPS 按 provider_switch 派生导出，消费点（config-bar/panel/两测试文件）import 路径
  零改动（FR-04 后半 / design Wave 3 步 3）。
implementation:
  - 将 frontend/src/lib/provider-caps.ts 定形为 task-04 脚本的生成产物（以重跑 node ../sillyhub-daemon/scripts/gen-provider-caps.mjs 落地为准，不手改 @generated 文件）——文件头 @generated 注记 + ProviderCaps 接口含 provider_switch（会话级供应商切换支持）第 10 键 + PROVIDER_CAPS + getProviderCaps（未知 provider 回退默认拒绝，provider_switch 回退 false）
  - 退役手写 PROVIDER_SWITCH_ENGINES 常量（:154-159 硬编码 new Set 三值，R-04 注释提醒同步义务随之消灭）——改为同文件内从 PROVIDER_CAPS 派生导出（provider_switch 为 true 的引擎集合），导出名与 ReadonlySet 类型形态不变，派生值锁定 claude/codex/pi 三值（cursor/未知仍锁）
  - 核对消费点零改动——session-config-bar.tsx、session-panel-page.tsx 及 session-config-bar.test.tsx、session-panel-provider-caps.test.tsx 四处 import 路径与形态不变（design 文件清单兜底条款预期零改动）
  - 消费面回归——tsc 0 错 + 两套件全绿，白名单派生值与原手写常量逐元素相等
acceptance:
  - cd frontend && pnpm exec tsc --noEmit 0 错
  - config-bar 35 用例（session-config-bar.test.tsx）+ provider-caps 20 用例（session-panel-provider-caps.test.tsx）两套件全绿
  - 派生 PROVIDER_SWITCH_ENGINES 与原手写常量逐元素相等（值恰为 claude/codex/pi 三值），消费点 import 零改动、两测试文件零改动即绿
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/sessions/__tests__/session-config-bar.test.tsx src/components/daemon/__tests__/session-panel-provider-caps.test.tsx
  - node sillyhub-daemon/scripts/gen-provider-caps.mjs 重跑后 git diff frontend/src/lib/provider-caps.ts 为空（产物一致性）
constraints:
  - 仅动 frontend/src/lib/provider-caps.ts；四消费点（config-bar/panel/两测试文件）零改动是硬约束
  - 文件保持 @generated 产物形态——与脚本输出有出入时以重跑产物为准、不手改生成物（脚本模板调整属 task-04 范围）
  - 不改 getProviderCaps 既有查询语义（未知回退默认拒绝）
  - 不动 backend 对齐守护（10 键已由 task-04 更新）
expects_from:
  - task-04: provider-caps.ts 生成产物由 gen-provider-caps.mjs 脚本产出（@generated 头 + 10 键 caps + PROVIDER_SWITCH_ENGINES 派生段模板）
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
