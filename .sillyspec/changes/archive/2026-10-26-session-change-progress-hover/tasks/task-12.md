---
id: task-12
title: 'Produce UI prototype artifact'
title_zh: 'UI 原型真码产出（prototype-session-change-progress.html）或登记复用留痕（R-06）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 14:17:38
priority: P0
depends_on: [task-08, task-09, task-10]
blocks: []
requirement_ids: [FR-01, FR-03, FR-05]
decision_ids: []
allowed_paths:
  - .sillyspec/changes/2026-10-26-session-change-progress-hover/prototype-session-change-progress.html
target_files: []
goal: >
  前端涉面 UI 原型留档（design 自审/R-06 承诺）：以真码管线产出或登记复用，禁手绘交付。
implementation:
  - '优先真码产出：从 task-08/09/10 落地组件抽取渲染产物（管线编译或真实渲染捕获）组 prototype-session-change-progress.html（含全量 5 圈行/轻量相位行/入口总圈三区块）'
  - '组件方言与实现同源（token 源 frontend/src/styles/themes.ts 语义阶）；素材来源声明（token 源/组件来源/入口位置）写在文件头注释'
  - '若判定登记复用（复用既有 session-pill 原型）：按 prototype-<名称>.html 命名登记并在文件头留复用声明'
acceptance:
  - '变更目录存在 prototype-session-change-progress.html（真码或登记复用留痕，非手绘）；FRONTEND_PAGE_STYLE 分级核对通过'
verify:
  - ls .sillyspec/changes/2026-10-26-session-change-progress-hover/prototype-session-change-progress.html
constraints:
  - '定稿=与实现同方言真码产物（管线编译/真实渲染捕获/登记复用三通道之一）；手写 HTML 不得交付（design 自审清单）'
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
