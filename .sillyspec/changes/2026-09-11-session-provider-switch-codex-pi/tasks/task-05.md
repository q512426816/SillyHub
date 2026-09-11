---
id: task-05
title: '前端解锁——PROVIDER_SWITCH_ENGINES 白名单 + 配置条/错误卡门禁白名单化 + 下拉按引擎过滤 + 锁定文案引擎中性化'
title_zh: '前端解锁——PROVIDER_SWITCH_ENGINES 白名单 + 配置条/错误卡门禁白名单化 + 下拉按引擎过滤 + 锁定文案引擎中性化'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 18:57:36
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/lib/provider-caps.ts
  - frontend/src/components/sessions/session-config-bar.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
target_files:
  - frontend/src/lib/provider-caps.ts
  - frontend/src/components/sessions/session-config-bar.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
provides:
  - contract: provider_switch_engines_whitelist
    fields: [PROVIDER_SWITCH_ENGINES, providerLocked_whitelist, agent_kind_filter, neutral_lock_title]
goal: >
  前端解锁 codex/pi 会话级供应商切换（FR-03 / D-002@v1）：provider-caps.ts 新增
  PROVIDER_SWITCH_ENGINES 白名单常量（依据=daemon 注入面并集：env REGISTRY（claude/pi）
  ∪ 文件层（codex/pi），design Wave 3 步骤 1 / R-04）；session-config-bar 的 providerLocked
  门禁白名单化 + 锁定文案引擎中性化 + 供应商下拉按会话引擎过滤 agent_kind（防选错 kind 撞 422）；
  session-panel-page 错误卡 timelineOnSwitchProvider 门禁同款白名单化（保留 provider 空前置）。
implementation:
  - provider-caps.ts（导出形态见 :21-134，现仅 ProviderCaps 接口 + PROVIDER_CAPS 表 + getProviderCaps）新增导出 PROVIDER_SWITCH_ENGINES = new Set(['claude','codex','pi'])，docblock 钉死两来源依据（env REGISTRY ∪ 文件层）并声明非 ProviderCaps 9 键矩阵成员、不参与三端同步（design 接口定义 / 非目标 / R-04）
  - session-config-bar.tsx:270 providerLocked 由 effectiveEngine != null && effectiveEngine !== "claude" 改为 effectiveEngine != null && !PROVIDER_SWITCH_ENGINES.has(effectiveEngine)（cursor/未知引擎仍锁）；:268-269 注释「D-010：Codex 引擎无会话级供应商」同步改写为白名单口径
  - session-config-bar.tsx:133 engine prop docblock「engine≠claude 锁供应商（D-010）」同步改写（注释与实现一致，CLAUDE.md 规则 18）
  - session-config-bar.tsx:468 锁定态 title「Codex 引擎暂不支持会话级供应商」改引擎中性「当前引擎不支持会话级供应商切换」（解锁后剩余锁定对象是 cursor/未知引擎，design Grill P2）
  - session-config-bar.tsx:491 供应商下拉候选改 providers.filter(p => p.agent_kind === effectiveEngine) 再 .map（agent_kind 类型 "claude"|"pi"|"codex" 与引擎字符串同源，llm-providers.ts:47）；effectiveEngine 为 null（provisional 悬浮助手形态，创建时才定引擎）维持全量；「不指定（本机默认）」项全引擎保留不动（现状渲染即如此）
  - session-panel-page.tsx:2358 timelineOnSwitchProvider 门禁白名单化：保留 session?.provider && 前置（provider 未知/空=不拦截，现状语义，Grill P2 不得顺手收窄 null 放行），仅把 session.provider !== "claude" 改为 !PROVIDER_SWITCH_ENGINES.has(session.provider)；警告文案「当前引擎不支持会话级供应商切换」不变
acceptance:
  - codex/pi 引擎会话供应商控件解锁可选（下拉可开、可点选「不指定」或具体供应商），claude 行为零漂移
  - cursor/未知引擎仍锁定：配置条 title 与错误卡提示均为引擎中性「当前引擎不支持会话级供应商切换」（不再点名 Codex）
  - effectiveEngine 为 null 时下拉候选全量；具体引擎会话下拉只列 agent_kind === 引擎 的供应商，「不指定（本机默认）」全引擎保留
  - 错误卡「切换供应商」：provider 为空/未下发的会话不拦截（现状语义），cursor/未知引擎仍弹「当前引擎不支持会话级供应商切换」
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/session-panel-provider-caps.test.tsx（本 task 后应全绿——该套件只测 multimodal/subagent 门控不涉供应商切换）
constraints:
  - 不改 ProviderCaps 9 键矩阵（白名单为前端本地常量，非三端同步键；design 非目标）；不动 running/ended 置灰与 providerOpenSignal 吞信号语义（providerLocked 仅换判定来源）
  - 不改任何测试文件——session-config-bar.test.tsx 的 codex 锁定三用例（:315/:405/:489）改后预期红，由 task-07 改写收口（design 文件变更清单已登记）
  - 不跑全量 frontend 测试（CLAUDE.md 规则 0）；不改 backend/daemon（本 task 独立于 daemon 侧，可并行）
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
