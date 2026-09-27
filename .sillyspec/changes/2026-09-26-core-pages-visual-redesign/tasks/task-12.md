---
id: task-12
title: 'top-bar token 修复 + 涉及文件硬编码色 grep 清零核对'
title_zh: 'top-bar token 修复 + 涉及文件硬编码色 grep 清零核对'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-27 00:40:13
priority: P0
depends_on: ['task-05', 'task-06', 'task-07', 'task-08', 'task-09', 'task-10', 'task-11']
blocks: []
requirement_ids: [FR-09, FR-10]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/top-bar.tsx
target_files:
  - frontend/src/components/top-bar.tsx
goal: >
  top-bar 面包屑 slate 硬编码换语义 token（三主题隐患修复），并对本变更全部涉及
  文件做硬编码色 grep 清零核对（FR-09 收口）。
implementation:
  - frontend/src/components/top-bar.tsx:125-148 面包屑 text-slate-800/500 等硬编码类换主题语义 token 类（结构零改动，token 替换级）
  - 清零核对（read-only 核对，发现问题回改对应 task 文件需在该 task allowed_paths 内）：grep 清单=bg-green-50、bg-red-50、bg-amber-50、border-amber-300、text-slate-800、text-slate-500 等语义硬编码——范围限本变更涉及文件（task-01~11 的 target/allowed 文件）
  - 三主题走查：blue/ai-native/dark 切换五页面 + /ppm/projects 基准页（R-07 抽查零回归）
acceptance:
  - top-bar 内 grep 无 text-slate-/bg-slate- 硬编码（换语义 token）
  - 本变更涉及文件硬编码色清单 grep 零命中（globals.css 既有 dark 补丁行不新增）
  - 三主题五页截图走查记录（dark 无新补丁）
verify:
  - grep -rn "text-slate-800\|border-amber-300\|bg-green-50" frontend/src/components/top-bar.tsx（应 0 命中）
  - cd frontend && pnpm typecheck
constraints:
  - top-bar 仅 token 替换（结构/布局/交互零改动，D-003 非目标边界）
  - grep 清零范围限本变更涉及文件（存量其他页面的硬编码不在此 task 扩面处理）
  - /ppm/projects 零改动（仅走查验证）
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
