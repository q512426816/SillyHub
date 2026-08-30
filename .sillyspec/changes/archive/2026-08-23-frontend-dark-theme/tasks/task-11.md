---
id: task-11
title: 'three-theme-browser-manual-check'
title_zh: '三主题浏览器实测与浅色回归目测'
author: 'qinyi'
created_at: 2026-08-23 23:17:51
priority: P0
depends_on: ['task-10']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - .sillyspec/changes/2026-08-23-frontend-dark-theme/prototype-frontend-dark-theme.html
  - .sillyspec/changes/2026-08-23-frontend-dark-theme/evidence
goal: >
  在真实浏览器里验收三主题切换、记忆、系统跟随与 dark 全站观感，并目测浅色两主题零回归，对照原型基准收口本变更。
implementation:
  - 启动前端 dev 服务（cd frontend && pnpm dev，或复用既有本地服务），浏览器打开站点
  - 三主题切换——顶栏 Palette 下拉三选一（AI 紫/明亮蓝/暗夜），选择即时全站换肤无 reload，当前项高亮
  - 刷新保持记忆——手动选各主题后刷新，localStorage sillyhub-theme 生效，首帧即正确主题无闪烁
  - 系统跟随——DevTools 模拟 prefers-color-scheme dark 并清空 sillyhub-theme 后刷新，首帧直接 dark 不闪白，hydrate 后不回跳浅色
  - dark 全站走查——列表页/工作区页/会话页/图表页/登录页，无残留纯白大色块，antd 表格/弹窗/菜单/气泡与图表文字暗色可读，对照 prototype 基准
  - 浅色两主题回归目测——blue 与 ai-native 逐页对照上线前观感与原型，slate 取值/bg-card 纯白/斑马纹等确认零回归
acceptance:
  - FR-01——dark 下页面底/卡片/边框/表格/表单/弹窗/菜单/气泡/图表文字全部暗色，品牌强调为亮紫，无纯白残留
  - FR-02——三选一切换即时生效，刷新后记忆保持且首帧正确
  - FR-03——无记录且系统暗色时首帧即 dark，无记录且系统浅色时默认 ai-native
  - FR-04——浅色两主题观感与上线前一致，目测零回归
verify:
  - 浏览器操作验收，逐项以截图或文字描述记录结论（本卡无命令行测试）
constraints:
  - 本卡零源码改动——只做实测与记录，发现问题登记回对应 task 修复后复测
  - 对照基准为变更目录 prototype-frontend-dark-theme.html，观感争议以原型为准
  - 不做系统明暗运行中实时监听的验证（design 非目标，切换系统主题需刷新才跟随）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
