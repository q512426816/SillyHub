---
id: task-09
title: echarts-theme-awareness
title_zh: 'ECharts 主题感知（aggregations.ts 颜色入参化 + 3 图表组件订阅 useThemeStore）'
author: 'qinyi'
created_at: 2026-08-23 23:17:51
priority: P1
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003@v1]
expects_from:
  task-01:
    - contract: themes
      needs: [dark]
allowed_paths:
  - frontend/src/lib/ppm/aggregations.ts
  - frontend/src/components/charts/WorkHourPieChart.tsx
  - frontend/src/components/charts/WorkHourBarChart.tsx
  - frontend/src/components/charts/RuntimeUsageLineChart.tsx
  - frontend/src/lib/ppm/__tests__/aggregations.test.ts
  - frontend/src/components/__tests__/work-hour-pie-chart.test.tsx
  - frontend/src/components/__tests__/work-hour-bar-chart.test.tsx
  - frontend/src/components/__tests__/runtime-usage-line-chart.test.tsx
related_tests:
  - path: frontend/src/lib/ppm/__tests__/aggregations.test.ts
    reason: CHART_COLORS 常量改工厂函数后既有断言（形状/取值）失效，需同步为工厂调用断言
  - path: frontend/src/components/__tests__/work-hour-pie-chart.test.tsx
    reason: 组件订阅 useThemeStore 后 mock 环境需提供 store 初值，快照/断言可能需同步
  - path: frontend/src/components/__tests__/work-hour-bar-chart.test.tsx
    reason: 同上
  - path: frontend/src/components/__tests__/runtime-usage-line-chart.test.tsx
    reason: 同上
goal: >
  ECharts 图表获得主题感知——aggregations.ts 的 CHART_COLORS 编译期静态取色
  （现取 themes[DEFAULT_THEME]）改为按当前主题取值入参化，三个图表组件订阅
  useThemeStore 注入文字/分割线色，dark 下图表文字可读且切换即时重渲染。
implementation:
  - aggregations.ts 将 CHART_COLORS 静态表改为按当前主题取值的工厂或参数注入，toBarSeries/toPieSeries 的文字色与分割线色由调用方按当前主题传入
  - 三组件（WorkHourPieChart/WorkHourBarChart/RuntimeUsageLineChart）订阅 useThemeStore，option 中 legend/axisLabel/label 文字色取 themes[theme].color 的 slate-600，splitLine 分割线色取 border
  - useMemo 依赖加入 theme，主题切换经订阅驱动即时重渲染
acceptance:
  - dark 主题下三图 legend/坐标轴/标签文字与分割线可读（对称翻转后亮灰系）
  - 浅色两主题图表观感与现状一致
  - 切换主题时图表即时重渲染，无需刷新页面
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm vitest run src/lib/ppm/__tests__/aggregations.test.ts src/components/__tests__/work-hour-pie-chart.test.tsx src/components/__tests__/work-hour-bar-chart.test.tsx src/components/__tests__/runtime-usage-line-chart.test.tsx
constraints:
  - ECharts 读不到 CSS 变量，取色必须走 themes 表这条既有通道（D-003@v1）
  - 不改图表数据逻辑与聚合算法（toNumber/Top N 聚合/空数据占位等）
  - 本卡 allowed_paths 内的既有测试因签名/形状变化失效的随卡修复（禁删断言，改口径）；task-10 负责全量回归与主题测试扩展
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
