---
author: flow-machine-draft
created_at: 2026-09-27T01:09:37.051Z
---
# 提案书（Proposal）— 2026-09-27-prototype-pipeline

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:8ced4ba6bc9c646ebd9be58c4c120cf1a1f7565b54584925217c4d18a7df5f25:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-prototype-pipeline 留痕重锚 -->
任务原话转写：背景：2026-09-26-core-pages-visual-redesign 暴露「选型方言原型（手写 HTML）→ 项目方言实现（Tailwind+token+primer 组件）」之间无机械桥梁，视觉保真度全流程零承接，差距部署后才被肉眼发现。已完成技术试点（本会话，未提交）：五页面视图用真实 primer 组件+themes.ts token 书写，经编译脚本产出自包含可双击 HTML（离线可用、三主题可切、DOM 实测无溢出）。本变更将试点固化为常设原型管线，并覆盖没有对应页面的流程描述类原型。
成功标准：
- pnpm prototype:build 一键产出全部原型视图的自包含 HTML（零外部引用、离线双击可用、内嵌三主题切换）
- 页面类原型：视图源码（tsx，import 生产 primer 组件与 token）入仓并通过 tsc 与 eslint
- 流程类原型：FlowDiagram 原语（节点/边 JSON 源 → 分层 SVG 布局，token 着色，零新增依赖）+ 至少一个真实流程示例视图入仓
- 原型分型规约落档（页面类/流程类/规则类各自的源方言、产物形态、批准与晋升路径）
- 既有业务页面与组件零改动（仅新增原型管线文件、package.json 脚本行、.gitignore）
- 编译产物入仓且与源码可对账（重编译后 git diff 为空）
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:b4edd04512c9f9374595b021d2a74db90afee122ee3f63fc4ff12049d1d22ac9:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-prototype-pipeline 留痕重锚 -->
按成功标准机械推导，共 7 条验收面：
1. pnpm prototype:build 一键产出全部原型视图的自包含 HTML（零外部引用、离线双击可用、内嵌三主题切换）
2. 页面类原型：视图源码（tsx，import 生产 primer 组件与 token）入仓并通过 tsc 与 eslint
3. 流程类原型：FlowDiagram 原语（节点
4. 边 JSON 源 → 分层 SVG 布局，token 着色，零新增依赖）+ 至少一个真实流程示例视图入仓
5. 原型分型规约落档（页面类/流程类/规则类各自的源方言、产物形态、批准与晋升路径）
6. 既有业务页面与组件零改动（仅新增原型管线文件、package.json 脚本行、.gitignore）
7. 编译产物入仓且与源码可对账（重编译后 git diff 为空）
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:311e46a5b872c807f42b6b7c560d34517071349c919c3e306f48affc41697f47:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-prototype-pipeline 留痕重锚 -->
1. pnpm prototype:build 一键产出全部原型视图的自包含 HTML（零外部引用、离线双击可用、内嵌三主题切换）
2. 页面类原型：视图源码（tsx，import 生产 primer 组件与 token）入仓并通过 tsc 与 eslint
3. 流程类原型：FlowDiagram 原语（节点
4. 边 JSON 源 → 分层 SVG 布局，token 着色，零新增依赖）+ 至少一个真实流程示例视图入仓
5. 原型分型规约落档（页面类/流程类/规则类各自的源方言、产物形态、批准与晋升路径）
6. 既有业务页面与组件零改动（仅新增原型管线文件、package.json 脚本行、.gitignore）
7. 编译产物入仓且与源码可对账（重编译后 git diff 为空）
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
