---
id: task-09
title: 'frontend vitest for ring numerator / unknown state / SSE realtime'
title_zh: 'frontend vitest——环分子口径 / 未知态 / SSE 实时更新'
author: 'qinyi'
created_at: 2026-08-27 23:57:01
priority: P0
depends_on: ['task-08']
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-003@v1]
expects_from:
  - 'task-08：usedTokens 可空 + 逆序最新非 null ctxTokens 口径 + 未知态渲染实现就绪'
allowed_paths:
  - frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-ctx-tokens.test.tsx
  - frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
goal: >
  vitest 固化环新口径（逆序最新非 null / 全 null 未知态非 0.0% / SSE 实时更新），
  并修复 task-08 文案与类型改动导致的既有断言失效（FR-01 / FR-02）。
implementation:
  - ctx-usage-bar.test.tsx：浮层口径断言由 /当前会话累计 token（含系统提示与历史轮次）/ 改为 /最近一次模型调用的提示词大小（含缓存命中部分）/；补 usedTokens={null} 用例（有分母）：环中心为「—」、textContent 不含 %、浮层「用量占比 未知」与已用分子「—」
  - 新增 session-panel-ctx-tokens.test.tsx：mock @/lib/daemon streamSession（先例 session-panel-dialog.test.tsx 的 stream.factory 模式）发 tokens 事件 env 携带 ctx_tokens，断言 ctx-ring 实时刷新
  - 同文件覆盖环分子口径：① 多轮 [null, 5000, 3000] → 3000；② 最新轮 null 上一轮 5000 → 5000；③ 全 null → 环未知态「—」非 0.0%；④ runsMeta 回填路径（listSessionRuns 返回 ctx_tokens）历史 turn 取值进环
  - 回归保留：既有数值用例（100k/200k=50%、50/80 阈值变色、超量封顶、无分母只显示累计）传 number 仍须通过
acceptance:
  - 全 null 用例断言环中心为「—」且无 0.0%、无百分比
  - 逆序取值用例断言环分子取最新非 null ctxTokens（而非 Σ inputTokens）
  - SSE 实时用例断言 tokens 事件 ctx_tokens 即时反映到环；runsMeta 回填用例断言历史值进入环
  - task-08 失效断言全部修复，无 skip / todo 跳过
verify:
  - cd frontend && pnpm test -- --run src/components/sessions/__tests__/ctx-usage-bar.test.tsx
  - cd frontend && pnpm test -- --run src/components/daemon/__tests__/session-panel-ctx-tokens.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 只跑本任务相关测试文件（CLAUDE.md 规则 0），全量留 CI
  - 只改 / 新增测试文件；发现实现缺陷回 task-08 修，不为通过测试弱化断言（规则 9）
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
