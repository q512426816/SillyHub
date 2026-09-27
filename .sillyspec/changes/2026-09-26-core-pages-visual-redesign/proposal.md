---
author: qinyi
created_at: 2026-09-27 00:58:00
---
# 提案书（Proposal）

## 动机

变更中心、工作区、会话是 SillyHub 使用频率最高的三类页面，用户明确反馈「现在的太丑了」并要求参考业界优秀设计重做。经四风格高保真原型对比（Linear/Vercel/Notion/GitHub），用户选定 GitHub/Primer 设计语言、彻底重设计（含交互）、范围三个主页面+两个核心详情页。

## 关键问题

1. **视觉语言碎片化**：同屏出现 4 种卡片圆角阴影、3 套按钮高度（shadcn 与 antd 混用，D-304 双体系豁免遗留）、10+ 种异构卡片——没有统一的设计语言层。
2. **可读性差**：全站大量 10-12px 小字，变更中心 7 列表格单格塞两行+两徽标，信息密度高但扫读效率低；空值 `—` 占位密集时页面破碎。
3. **主题铁律被侵蚀**：top-bar 面包屑 slate、概览页 amber 横幅、详情页 green 成功条等硬编码色残留，dark 主题靠逐类打补丁维持。

## 变更范围

- 新建 `frontend/src/components/primer/` 共享组件库（StateLabel/Counter/UnderlineNav/IssueRow/Timeline/MetaPanel/PageHead/StatGrid/EmptyState/StateIcon，各配 vitest 单测）。
- themes.ts semantic 五档扩展 soft 浅底阶（三主题各配）。
- 五页面按原型 `prototype-github-redesign.html` 重排：变更中心列表（7 层→4 层、antd Table 退役）、变更详情（PR checks 横条+时间线+MetaPanel）、工作区列表（卡片网格→行式列表、drag-grid 行式化）、工作区概览（Hero→Repo 首页式）、会话门户（三栏展示层 Primer 化，四分支全覆盖）。
- 交互修复：window.confirm→Modal、手写分页→规范分页、条件区收敛 flash 告警条。
- FRONTEND_PAGE_STYLE.md 回写 primer 规范 + 改写 D-304 双体系条款；top-bar 硬编码 slate 换 token。

## 不在范围内（显式清单）

- 不做后端 API / DTO / 数据库 schema 改动（不触发 pnpm gen:types）
- 不改路由结构（URL 不变）
- 不动 WorkspaceTabs 17-tab 导航壳与 AppShell 布局壳（top-bar 仅 token 替换级修复）
- 不重构会话门户状态机 / 数据流 / 轮询 / WS 消息处理
- 不做移动端适配

## 成功标准（可验证）

- 五页面 DOM 结构与原型五视图对照一致（区域、层级、组件形态），现有行为（智能轮询、深链、批量操作、拖拽排序、群聊/预会话/空态四分支）全部保留。
- primer 组件单测全绿；五页面既有测试（改断言不改意图）全绿；tsc 0 错误。
- 全仓 grep 无新增硬编码色值（bg-green-50/text-slate-800/border-amber-300 等清单清零，本次涉及文件内）。
- 三主题（blue/ai-native/dark）逐页截图走查通过，dark 主题无补丁式覆盖残留。
- FRONTEND_PAGE_STYLE.md 含 primer 章节，D-304 条款已改写。
