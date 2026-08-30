---
id: task-06
title: 'switch antd algorithm to darkAlgorithm on dark theme'
title_zh: 'antd-providers.tsx 按主题切换 darkAlgorithm'
author: 'qinyi'
created_at: 2026-08-23 23:17:51
priority: P0
depends_on: ['task-01']
blocks: []
expects_from:
  task-01:
    - contract: themes
      needs: [dark]
requirement_ids: [FR-01]
decision_ids: [D-006@v1]
allowed_paths:
  - frontend/src/components/antd-providers.tsx
goal: >
  ConfigProvider 新增 algorithm 字段——theme 为 dark 时取 antdTheme.darkAlgorithm，
  否则 defaultAlgorithm，使 antd 组件灰阶在暗色下自动适配；token 与 components
  查表逻辑零改动，暗色翻转阶经 themes 表供给（design §5.2/§7、D-006@v1）。
implementation:
  - 从 antd 增加 import theme as antdTheme（别名避免与本地变量 theme 冲突）
  - theme 配置加 algorithm 三元——dark 取 darkAlgorithm，其余取 defaultAlgorithm
  - token 与 components 查表逻辑保持零改动（表头/行悬浮/Menu 选中 brand-50 翻转阶自动给深紫底亮紫字）
  - 文件头注释补 D-006@v1 口径（dark 经 darkAlgorithm，token 继续查表不加分支）
acceptance:
  - dark 下 Table 表头与行悬浮、Menu 选中、Tabs 等组件灰阶自动暗色适配，无白底残留（对照原型，R-03 组合效果 execute 期首批验证）
  - blue 与 ai-native 下 algorithm 恒为 defaultAlgorithm，观感与现状零变化
  - 主题切换即时生效（useEffect 同步 data-theme 的链路不动）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
constraints:
  - 组件 token 不加 dark 分支（D-006 决策）；不改 useEffect data-theme 同步与 dayjs locale 逻辑
  - darkAlgorithm 与 brand-50 组合出怪色时按 R-03 处理——回 dark 取值表微调（task-01 侧），本文件不加 hack
  - 不新增测试文件（组件级暗色断言归 task-10 与 task-11）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
