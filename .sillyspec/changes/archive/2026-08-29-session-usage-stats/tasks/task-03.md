---
id: task-03
title: 'frontend getSessionUsage + SessionUsageBar component'
title_zh: 'frontend getSessionUsage 封装 + 会话用量条组件 + 组件测试'
author: 'qinyi'
created_at: 2026-08-29 21:47:06
priority: P0
depends_on: [task-02]
blocks: [task-04, task-05]
requirement_ids: [FR-02, FR-03]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths:
  - frontend/src/lib/daemon.ts
  - frontend/src/components/daemon/session-usage-bar.tsx
  - frontend/src/components/daemon/__tests__/session-usage-bar.test.tsx
expects_from: 'task-02 provides：GET /api/daemon/sessions/{id}/usage → SessionUsageRead JSON'
goal: >
  实现自取数会话用量条组件（摘要行五指标+命中率、按模型折叠明细、refreshSignal 重取），不依赖 react-query（dialog 零 QueryClientProvider 约束）。
implementation:
  - lib/daemon.ts：手写 SessionUsageRead/SessionUsageModelItemRead 本地接口（与 task-02 DTO 同构，注释锚定 D-004/gen:types 收口说明——api-types 生成物在 task-05 才有）+ getSessionUsage(sessionId) 封装
  - session-usage-bar.tsx：props { sessionId, refreshSignal? }；useEffect([sessionId, refreshSignal]) 自取数本地 state；命中率 helper 单点实现 cache_read/(cache_read+input)（分母 0 → null 显示「—」，注释锚定 D-003）；摘要行 + 折叠明细表（视觉基准 prototype-session-usage.html，「未记录」桶补「（旧轮次）」后缀）；数字万级缩写/千分位对齐 runtime-card 先例
  - 组件测试（不挂 session-panel，挂载用例归 task-04）：①摘要五指标+命中率百分比；②分母 0 →「—」；③折叠/展开交互；④refreshSignal 递增重取（mock getSessionUsage 调用计数，无 QueryClientProvider）
acceptance:
  - AC-03 组件本体部分 + AC-04 组件级验证通过
verify:
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/session-usage-bar.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不用 react-query/useQueryClient（dialog 约束，R-04）；不改 session-panel（归 task-04）
  - 不改 api-types.ts（生成物，归 task-05）；daemon.ts 内手写类型为过渡终态（注释说明与后端 DTO 同构）
  - UI 中文文案；样式遵循 AI-Native 双主题 token（brand-* 语义阶）
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
