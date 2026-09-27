---
id: task-02
title: 'primer 基础原子组件（StateIcon/StateLabel/Counter/EmptyState）+ 单测'
title_zh: 'primer 基础原子组件（StateIcon/StateLabel/Counter/EmptyState）+ 单测'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-27 00:40:13
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/primer/
  - frontend/src/components/primer/__tests__/
target_files:
  - NEW:frontend/src/components/primer/state-icon.tsx
  - NEW:frontend/src/components/primer/state-label.tsx
  - NEW:frontend/src/components/primer/counter.tsx
  - NEW:frontend/src/components/primer/empty-state.tsx
  - NEW:frontend/src/components/primer/__tests__/primer-atoms.test.tsx
provides:
  - contract: PrimerStateLabel
    fields: [variant, withIcon, iconName, size, children]
expects_from:
  task-01:
    needs: [--semantic-*-soft CSS var 三主题注入]
goal: >
  建 primer 基础原子组件四件：StateIcon（六态 16/12px stroke SVG）、StateLabel（六变体
  浅底深字胶囊）、Counter（计数胶囊）、EmptyState（空态），全走主题 token 零硬编码。
implementation:
  - NEW frontend/src/components/primer/state-icon.tsx：openCircle/mergedCheck/zap/clock/check/x 六图标 + neutral 空图标，props {name, size}，内嵌 SVG stroke 1.5px（对齐原型 prototype-github-redesign.html symbol 风格）
  - NEW frontend/src/components/primer/state-label.tsx：variant∈open|merged|attention|done|error|neutral，浅底=var(--semantic-*-soft)、文字/边框=语义主值；iconName zap|clock 仅 attention 生效（轻量/等待双态，默认 zap）；size sm|md
  - NEW frontend/src/components/primer/counter.tsx：灰底圆角胶囊数字，active 态主色描边
  - NEW frontend/src/components/primer/empty-state.tsx：图标+标题+描述+可选 action 插槽，替代破碎 `—` 空态
  - NEW frontend/src/components/primer/__tests__/primer-atoms.test.tsx：六变体渲染矩阵 + iconName 双态 + Counter active + EmptyState 插槽
acceptance:
  - 组件文件内 grep 无 hex 色值（#[0-9a-f]{3,8} 零命中，SVG currentColor 除外）
  - 单测覆盖 StateLabel 六变体 × iconName 两态渲染断言
  - tsc 0 新增错误
verify:
  - cd frontend && pnpm vitest run src/components/primer/__tests__/primer-atoms.test.tsx
  - cd frontend && pnpm typecheck
constraints:
  - 不依赖 antd/Radix（纯 Tailwind + CSS var，可 SSR）
  - 中文文案内置（EmptyState 默认文案中文）
  - 不在本 task 建 index.ts（task-04 桶导出收口）
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
