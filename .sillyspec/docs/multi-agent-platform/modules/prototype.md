---
schema_version: 1
doc_type: module-card
module_id: prototype
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:42
---
# prototype

## 定位

multi-agent-platform 的 UI/交互线框原型集合。以单文件 HTML（纯 CSS/JS，浏览器直接打开）形式承载变更设计阶段的可视化推演，覆盖守护进程接入、管理后台、API Key、Agent 日志查看、Codex 交互会话、运行时会话弹窗、变更详情等场景。不是生产代码，不进入 backend/frontend 构建；作用是把"页面上长什么样、怎么点"在设计期就拉齐共识，降低 frontend 实现返工。被 frontend 实现时参考。

技术栈：原生 HTML + 内联 CSS + 内联 JS，零依赖、零构建。

## 契约摘要

原型文件统一放在 `.sillyspec/changes/<change-id>/prototype-<change-id>.html`，随变更目录生命周期管理。当前已存在的代表性原型：

- `.sillyspec/changes/2026-06-09-local-daemon/prototype-local-daemon.html`
- `.sillyspec/changes/2026-06-16-admin-org-role-center/prototype-admin-center.html`
- `.sillyspec/changes/2026-06-16-daemon-api-key/prototype-api-keys.html`
- `.sillyspec/changes/2026-06-22-agent-run-pipeline-fix/prototype-agent-log-viewer.html`
- `.sillyspec/changes/2026-06-23-codex-interactive-session/prototype-codex-interactive-flow.html`
- `.sillyspec/changes/2026-06-23-runtimes-session-dialog/prototype-runtimes-session-dialog.html`
- `.sillyspec/changes/agent-driven-change-center/prototype-change-detail.html`

文件头有注释块标注 author/created_at/desc，说明该原型的线框主题与交互要点。

## 关键逻辑

- **形态约定**：单 HTML 文件，`:root` 定义 CSS 变量调色板（边框/背景/主色/状态色），`.wrap` 居中容器，用 div 卡片模拟页面区块，纯 JS 切换显隐模拟交互。
- **与 frontend 的关系**：原型是 frontend 组件实现的视觉/交互蓝本，frontend 落地时用 Ant Design/Tailwind 重写，原型本身不被引用。
- **与 sillyspec 流程的关系**：原型通常在 brainstorm/design 阶段产出，作为 design.md 的配套可视化，verify 时不作硬性校验对象。
- **随变更归档**：变更 archive 时原型随 changes 目录一起进入 archive，作为历史决策留痕。

## 注意事项

- 原型是"用完即存档"的产物，不维护、不迭代，改设计应出新原型而非改老原型。
- 原型不代表最终视觉风格（颜色/字体为线框示意），frontend 实现以实际 UI 规范为准。
- 新增大功能变更鼓励先出原型拉齐共识，但小修复/后端-only 变更无需强制。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
