---
id: task-04
title: 'RoundDivider +mobile prop 折行/数字缩写（FR-02）'
title_zh: 'RoundDivider +mobile prop 折行/数字缩写（FR-02）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 23:19:47
priority: P0
depends_on: []
blocks: [task-05]
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/chat/round-divider.tsx
  - frontend/src/components/chat/__tests__/round-divider.test.tsx
target_files:
  - frontend/src/components/chat/round-divider.tsx
  - frontend/src/components/chat/__tests__/round-divider.test.tsx
goal: >
  治手机端轮次信息胶囊溢出（截图②「第 1 轮 · 运行中 · ↑78,489 ↓2,170 · 53 tok/s ·
  开始 2X:XX」超宽）：RoundDivider 新增 mobile prop——meta 段允许折行 + 大数字缩写；
  desktop 不缩写不折行（锚定）。
implementation:
  - 导出纯函数 abbreviateCount(n)：≥10000 → (n/1000).toFixed(1)k（78,489→78.5k，口径全局统一，plan 盲区③）
  - props 加 `mobile?: boolean`（默认 false）
  - meta 为单一 string prop（round-divider.tsx:61/:106 整串渲染，plan 评审 gap-1）：mobile=true 时组件内对 meta 串做数字段替换——正则命中 ↑/↓ 后 ≥5 位数字（含千分位逗号）段经 abbreviateCount 变换，其余字符不动；desktop 路径不做替换零变化
  - mobile=true：meta 容器 flex-wrap 允许折行
  - 测试：缩写纯函数用例（边界 9999/10000/99999）+ meta 串替换用例（↑78,489 → ↑78.5k）+ mobile 折行断言 + desktop 不缩写锚
acceptance:
  - mobile=true 且 meta 含 78,489 时渲染 78.5k
  - mobile 缺省渲染与改动前一致（既有 5 用例零改动通过）
verify:
  - cd frontend && pnpm vitest run src/components/chat/__tests__/round-divider.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - label/status/时间文案不动，只动 meta 数字段
  - 缩写只作用于 ≥10000 整数（tokens/字节计数），百分比/速率（53 tok/s）不缩写
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
