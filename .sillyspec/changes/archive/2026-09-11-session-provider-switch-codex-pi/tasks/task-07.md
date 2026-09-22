---
id: task-07
title: 'frontend 测试收口——门禁矩阵（claude/codex/pi 放行，cursor/未知锁定）+ kind 过滤 + provider 空前置（含 session-config-bar.test.tsx codex 锁定三用例改写）'
title_zh: 'frontend 测试收口——门禁矩阵（claude/codex/pi 放行，cursor/未知锁定）+ kind 过滤 + provider 空前置（含 session-config-bar.test.tsx codex 锁定三用例改写）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 18:57:36
priority: P0
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx
target_files:
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx
expects_from:
  task-05:
    - contract: provider_switch_engines_whitelist
      needs: [PROVIDER_SWITCH_ENGINES, providerLocked_whitelist, agent_kind_filter, neutral_lock_title]
related_tests:
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx
goal: >
  frontend 测试收口（FR-03 / D-002@v1）：task-05 白名单解锁后 session-config-bar.test.tsx
  的 codex 锁定三用例（:315/:405/:489）断言失效，改写为 claude/codex/pi 放行 + cursor/未知
  锁定的门禁矩阵；补供应商下拉 kind 过滤（engine null 全量）与错误卡 provider 空不拦截用例，
  以测试锁定解锁语义。
implementation:
  - session-config-bar.test.tsx codex 锁定三用例改写为解锁矩阵：:315「Codex 引擎（engine≠claude）→ 供应商控件禁用（D-010）」改为 codex 引擎控件可用（disabled=false，档案控件断言保留）；:405「Codex 引擎锁定（D-010）→ 信号不开下拉」改为 codex 信号开下拉（config-dd-provider 出现），锁定负例换 cursor（或未知引擎字面量）信号被吞；:489「providerLocked（Codex）/「不指定」两态 → 模型子下拉不渲染」中 Codex 分支改为选中供应商后模型子下拉渲染，「不指定」隐藏分支保留
  - 锁定负例的 title 断言改中性文案「当前引擎不支持会话级供应商切换」（grep 确认测试内无「Codex 引擎暂不支持」残留断言）
  - config-bar 补 kind 过滤用例：mock listProviders 混合 agent_kind（claude/codex/pi 各至少一项），codex 引擎下拉只列 agent_kind === "codex" 项 + 「不指定（本机默认）」（后者全引擎保留，D-002）；engine null（BASE_PROPS 不传 engine 且 configSnapshot.engine 缺省）全量列出
  - session-panel-provider-caps.test.tsx（现仅 multimodal/subagent 门控，mock 结构沿用）扩展错误卡「切换供应商」门禁矩阵：claude/codex/pi provider 会话放行（定位配置条不弹警告）；cursor/未知 provider 弹「当前引擎不支持会话级供应商切换」；provider 空（null/未下发）不拦截（现状语义锁定，Grill P2 不收窄 null 放行）
acceptance:
  - 门禁矩阵全绿：claude/codex/pi 供应商控件可用 + 信号开下拉 + 错误卡放行；cursor/未知引擎锁定且文案引擎中性
  - kind 过滤断言通过：具体引擎只列同 agent_kind 供应商，engine null 全量，「不指定（本机默认）」全引擎保留
  - 错误卡 provider 空不拦截用例通过（现状语义锁定）
  - 两套件无 skip/todo；codex 旧锁定断言全部清除（无残留「D-010」锁定口径的 codex 用例）
verify:
  - cd frontend && pnpm vitest run src/components/sessions/__tests__/session-config-bar.test.tsx src/components/daemon/__tests__/session-panel-provider-caps.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不跑全量 frontend 测试，只跑上述两套件（CLAUDE.md 规则 0）
  - 只改两测试文件，不改组件源码——发现组件缺陷回 task-05 卡修（本卡 allowed_paths 不含源码）
  - 测试改写仅限语义翻转的三用例与新增用例，其余既有用例不得改预期（CLAUDE.md 规则 9：本次改写依据是 design 白名单语义变更，非凑绿）
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
