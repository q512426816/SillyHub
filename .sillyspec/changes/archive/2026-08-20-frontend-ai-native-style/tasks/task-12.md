---
id: task-12
title: info 档改 accent 青——经 `themes.semantic.info`（antd ConfigProvider `colorInfo`）实现，`status-badge.tsx` 本体核对后预计零代码改动（组件是 kind→antd Badge status 映射，无色值）；登录页渐变主题化（覆盖：FR-04, FR-06, D-003@v2）
title_zh: info 档改 accent 青——经 `themes.semantic.info`（antd ConfigProvider `colorInfo`）实现，`status-badge.tsx` 本体核对后预计零代码改动（组件是 kind→antd Badge status 映射，无色值）；登录页渐变主题化（覆盖：FR-04, FR-06, D-003@v2）
author: qinyi
created_at: 2026-08-20 02:20:18
priority: P1
depends_on: [task-01, task-05]
blocks: []
requirement_ids: [FR-04, FR-06]
decision_ids: [D-003@v2]
allowed_paths:
  - frontend/src/components/ui/status-badge.tsx
  - frontend/src/app/(auth)/login/page.tsx
expects_from:
  - contract: themes
    needs: [blue, ai-native]
goal: >
  info 状态档两主题统一 accent 青——经 themes.semantic.info→antd colorInfo 链路生效而非改组件本体；登录页硬编码品牌蓝渐变/hex/阴影主题化，两主题下协调且 blue 可还原旧观感。
implementation:
  - 核对 status-badge.tsx——已确认为 KIND_TO_ANTD_STATUS 纯 kind→antd Badge status 映射（info→processing），组件内无任何色值；青色经 task-05 antd-providers ConfigProvider token.colorInfo=themes[t].color.semantic.info（blue=#06b6d4 / ai-native=#0891B2）自动生效，本卡对该文件零改动
  - login/page.tsx 品牌区渐变主题化——:254 from-blue-700 via-blue-800 to-slate-950 改 brand 阶/CSS 变量主题感知渐变，:273 bg-blue-500/30 光斑同步替换
  - login/page.tsx 其余品牌蓝清理——:134 表单区光晕 bg-blue-100/60 与 :150 登录卡阴影 rgba(37,99,235,0.18) 改主题变量；深底浅文字 text-blue-100 系（:293/:302/:345）改主题对应浅档保持可读
  - cyan/indigo 装饰光斑与 text-cyan-200 等非品牌蓝按原型两主题协调取值，不强清扫
acceptance:
  - kind=info 的 StatusBadge 圆点在 blue 与 ai-native 两主题下均为 accent 青，status-badge.tsx 本体 git diff 为空
  - login/page.tsx 内 bg-blue-|text-blue-|rgba(37,99,235 品牌用途清零（装饰/信息语义逐一判断后允许保留）
  - blue 主题登录页观感与重构前一致（design §9 验收口径；info 徽标档为已声明例外）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec eslint src/components/ui/status-badge.tsx src/app/\(auth\)/login/page.tsx
constraints:
  - status-badge.tsx 预计零改动——已核对 kind→antd Badge status 映射不受主题影响，仅当复核发现色值才允许改
  - themes.ts 归 task-01（semantic.info=accent 由其定义）、antd-providers colorInfo 消费归 task-05，本卡均不改
  - 登录页仅改样式类名/取值——表单校验、验证码、平台切换、记住登录名等业务逻辑零改动
  - info 统一青为两主题例外（design §9 例外声明），不做 blue 主题回退旧蓝的分支处理
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
