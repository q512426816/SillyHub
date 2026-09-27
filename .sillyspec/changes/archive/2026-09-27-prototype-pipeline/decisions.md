---
author: flow-machine-draft
created_at: 2026-09-27T02:07:43.021Z
---
# 决策记录（Decisions）— 2026-09-27-prototype-pipeline

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：Tailwind 全量 CSS 使每产物 ~150KB、七文件合计 ~1MB 入仓——接受（纯文本 git 增量压缩后很小；后续可加按视图 content 裁剪优化，非本变更范围）。次风险：视图静态渲染无水合，交互仅 vanilla JS 子集（主题切换/tab 过滤）——规约中明示，需要完整交互的原型走 dev 预览路由（后续变更）。 试过放弃：① mermaid 文本方案——渲染产物需浏览器运行时（内联 mermaid.js ~2MB/文件）或引入 puppeteer 重依赖，放弃；② 复用 @xyflow/react——交互式定位编辑超流程「描述类」原型所需，静态渲染下自动布局不稳定，放弃。
