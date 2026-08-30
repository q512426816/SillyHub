---
id: task-10
title: 'themes-tests-expansion-and-suite-regression'
title_zh: 'themes.test.ts 扩展 + 存量测试回归'
author: 'qinyi'
created_at: 2026-08-23 23:17:51
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05', 'task-06', 'task-07', 'task-08', 'task-09']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-004@v1, D-005@v1]
allowed_paths:
  - frontend/src/styles/themes.test.ts
  - frontend/src/stores/theme.test.ts
goal: >
  扩展主题单测覆盖 dark 取值完整性与翻转对称性并锁定浅色零回归，再跑全量前端测试确认存量套件无回归（design R-07）。
implementation:
  - themes.test.ts 扩展 dark 用例——取值完整性断言，brand 十一档（50-950）、slate 十档（50-900）、语义五档（success/warning/error/info/neutral）键齐全，三套主题 color 键集合深度同构（沿用 keySkeleton 模式）
  - 对称翻转断言——dark 的 slate 50 等于浅色 slate 900、dark 的 slate 100 等于浅色 slate 800、dark 的 brand 600 等于浅色 brand 400、dark 的 brand 50 等于浅色 brand 950 等代表性翻转点（D-004）
  - 浅色零回归断言——blue 与 ai-native 两主题 slate 十档取值与 Tailwind v3 默认 hex 逐值相等（D-005），防 slate 变量化（task-03）漂移
  - themes 注册表断言更新——键集合恰含 blue、ai-native、dark 三键，DEFAULT_THEME 仍为 ai-native，info 例外契约（semantic.info 等于 accent）扩到三套
  - theme.test.ts 脏值用例口径更新——dark 转为合法值后前提反转，改用新的非法样例值（如 midnight）预写后重建 store，断言 merge 兜底回 ai-native
  - theme.test.ts 补 dark 合法路径——setTheme dark 切换 getState 正确、persist 写入 sillyhub-theme 的 JSON 含 dark
  - 跑全量前端测试修 mock 补字段——存量 mock 主题名仅 blue/ai-native 的按需补 dark 取值，不改测试逻辑本身；暴露无关旧测试债按 CLAUDE.md 规则 21 惯例顺手补好
acceptance:
  - dark 完整性、翻转对称、浅色 slate 逐值相等三组新断言全部通过
  - 脏值兜底用例以新非法样例值通过，dark 作为合法值的切换与持久化断言通过
  - cd frontend && pnpm test 全量绿，既有套件零失败
verify:
  - cd frontend && pnpm test
constraints:
  - 禁止为通过而删既有断言或放宽断言口径（CLAUDE.md 规则 9）
  - 修 mock 只补字段或补取值，不为躲报错改回手写或删断言
  - 色阶断言取值只允许 Tailwind v3 默认 hex，禁止自调色
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
