---
id: task-02
title: 'globals.css m-app 密度规约块（FR-08 基准）'
title_zh: 'globals.css m-app 密度规约块（FR-08 基准）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 23:19:47
priority: P1
depends_on: []
blocks: [task-10, task-11]
requirement_ids: [FR-08]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - frontend/src/app/globals.css
target_files:
  - frontend/src/app/globals.css
goal: >
  在 globals.css 新增 /m/ 壳内密度规约块：以 .m-app 容器后代选择器统一手机端
  控件密度基准（按钮高度/卡片内距/列表行距一档），W3 页面引用同一基准，避免逐页散调。
implementation:
  - 定位既有 `[data-variant="mobile"]` / `.m-app` 样式块（ql-20260827-012 先例），在其相邻新增密度段
  - 规约项：.m-app 内 button 高度 36px 基准、卡片 padding 12px、列表行最小高 44px 触控达标（保留各页面覆盖权）
  - 每条规则注明「/m/ 壳内密度规约（2026-10-26-mobile-four-page-layout-fix）」来源注释
acceptance:
  - 所有新规则都挂在 .m-app 后代选择器下（PC dashboard 不受影响——grep 断言无裸元素选择器）
  - tsc/lint 通过（CSS 文件走 lint 面）
verify:
  - cd frontend && pnpm lint
  - grep -n "m-app" frontend/src/app/globals.css 核对新增段归属
constraints:
  - 禁止新增全局断点类（sm:/md:）与裸元素规则（D-002@v1）
  - 不动既有 [data-variant="mobile"] 排版块数值（ql-20260915-009 已调优的正文排版不动）
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
