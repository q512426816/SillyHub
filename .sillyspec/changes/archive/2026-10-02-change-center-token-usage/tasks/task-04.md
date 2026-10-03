---
id: task-04
title: '前端展示与契约收口——gen:types 复核零 diff + change-usage-card「本地 CLI」桶行/注脚 + 组件测试 + tsc'
title_zh: '前端展示与契约收口——gen:types 复核零 diff + change-usage-card「本地 CLI」桶行/注脚 + 组件测试 + tsc'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-02 23:14:36
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-03, FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/changes/detail/change-usage-card.tsx
  - frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
target_files:
  - frontend/src/components/changes/detail/change-usage-card.tsx
  - frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
expects_from:
  task-03:
    - contract: ChangeUsageRead/UsageSummaryRead 本地段并入
      needs: [totals 四维含本地量, by_model 含「本地 CLI」桶行]
related_tests:
  - frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx
goal: >
  用量卡渲染「本地 CLI」桶行（绿阶 tag + 请求列「—」）+ 注脚口径更新，纯本地变更不误触空态；
  契约复核 gen:types 零 diff（后端 DTO 未变），聚焦回归收口。
implementation:
  - 先跑 pnpm gen:types（前置：pnpm exec tsc --version 确认 node_modules 健康，CLAUDE.md 规则 21）：预期零 diff（task-03 未改 DTO 字段集）——若有意外 diff 查明原因（允许注释级 openapi 变化），同步提交 api-types.ts + backend/openapi.json
  - frontend/src/components/changes/detail/change-usage-card.tsx：新增 LOCAL_CLI_MODEL = "本地 CLI" 常量（与后端桶名约定一致）；明细表渲染三分支——「未记录」灰阶（既有 :316-333）、「本地 CLI」绿阶 tag（border-emerald-200 bg-emerald-50 text-emerald-700，title 提示「本地 CLI 会话上报解析的累计用量」）、正常模型 brand 阶（既有）；本地 CLI 行请求列 api_requests=0 时显示「—」（对齐「未记录」桶先例的 0 显示优化：恒「—」）
  - USAGE_NOTE_TEXT（:39-43）双 kind 更新：change 侧加「本地 CLI 会话（daemon 解析日志落库快照）计入，请求次数与轮次无来源不计」；quicklog 侧同句式
  - hasNoExecution（:113-126）行为验证不改代码：纯本地变更（三元组 None + totals 非 0）不触发空态（Grill X5 已实证）；「进行中」标记 started None 时不渲染已满足
  - frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx 追加用例：by_model 含「本地 CLI」桶行渲染绿阶 tag + 请求「—」；纯本地数据（started_at null + input>0）不渲染「尚无关联执行」；注脚含「本地 CLI」字样（若既有用例断言旧注脚文案，同步更新）
acceptance:
  - 明细表「本地 CLI」行绿阶渲染、请求列「—」、命中率照常；totals 摘要行合并值自动正确（数据侧 task-03 保证）
  - 纯本地变更不触发空态文案；取数失败静默降级不回归
  - gen:types 零 diff（或已同步提交且有原因说明）
verify:
  - cd frontend && pnpm test -- change-usage-card
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 列表「执行」列与移动端不改（数据自动并入，design 非目标）；不改取数封装 lib/changes.ts（DTO 未变）
  - 不改后端（契约复核只读跑 gen:types）
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
