---
author: qinyi
created_at: 2026-06-22T00:01:02
---

# decisions.md — 2026-06-21-frontend-style-system 决策台账

> 只记录有实现/验收影响的决策。长期术语在 archive/scan 时提升到 glossary.md。

## D-001@v1: 暗色模式
- type: boundary
- status: accepted
- source: user
- priority: P1
- question: 是否需要完整暗色模式?
- answer: 专注亮色(YAGNI),本轮不实现暗色切换
- normalized_requirement: 本轮仅亮色;token 用语义变量组织便于以后扩展;design 非目标明确排除暗色
- impacts: [非目标, P0 token 结构]
- evidence: 用户 step6 回答"专注亮色"

## D-002@v1: 登录页风格
- type: boundary
- status: accepted
- source: user+architect
- priority: P1
- question: 登录页是否跟随统一风格?
- answer: 跟随统一明亮蓝同色系,作为首屏保留柔和渐变 hero + 品牌 logo,废弃孤立深蓝紫 #1a2a6c 独立宇宙
- normalized_requirement: login/page.tsx 重做为明亮蓝 hero(同色系)+ shadcn Card + antd Form,不得引入主应用外孤立配色
- impacts: [P7, 验收 5]
- evidence: step7 Grill 内联 + 用户选"全站统一改"

## D-003@v1: 侧边栏图标
- type: boundary
- status: accepted
- source: code+architect
- priority: P1
- question: 侧边栏用 emoji 字符当图标,lucide 已装未用,是否替换?
- answer: 统一替换为 lucide-react 图标
- normalized_requirement: app-shell.tsx 侧边栏菜单图标全部用 lucide,不得用 emoji/字符
- impacts: [P5, 验收 4]
- evidence: Explore 调研 app-shell.tsx:99-105 用字符串 emoji;lucide 在 package.json

## D-004@v1: Inter 字体引入方式
- type: architecture
- status: accepted
- source: architect
- priority: P1
- question: Inter 非系统字体,如何引入规避 Docker 构建代理?
- answer: self-host(next/font/local + 本地 woff2),不依赖构建期外网
- normalized_requirement: 用 next/font/local 加载本地 Inter woff2;系统字体栈降级兜底;不得用 next/font/google
- impacts: [P0, R-01]
- evidence: memory 记录 Docker 前端代理/healthcheck 问题;构建环境网络受限

## D-004@v2: Inter 字体来源细化
- type: feasibility
- status: accepted
- supersedes: D-004@v1
- source: design-grill
- priority: P1
- question: v1 说 self-host(next/font/local + 本地 woff2),但 woff2 文件来源未明确,手动下载不可靠
- answer: 用 `@fontsource/inter` npm 包提供 woff2(node_modules 自带),`next/font/local` 指向包内文件;免手动下载/外网依赖
- normalized_requirement: 安装 `@fontsource/inter`;`next/font/local` 指向 `node_modules/@fontsource/inter/files/inter-latin-*-400-*.woff2`;不得用 next/font/google
- impacts: [P0, R-01, 文件清单]
- evidence: Design Grill X-001 可行性交叉检查

## D-005@v1: 状态色统一
- type: architecture
- status: accepted
- source: architect
- priority: P1
- question: 状态色 antd Tag 预设 vs shadcn Badge variant 双轨且硬编码,如何统一?
- answer: 建立统一状态语义 token(success/warning/error/info/neutral),antd Tag 与 shadcn Badge 共同消费 StatusBadge,消除硬编码 emerald/amber
- normalized_requirement: 所有状态展示走 StatusBadge({kind});globals.css 的 --success/--warning 映射到 Tailwind;不得新增硬编码状态色
- impacts: [P1, P3, 验收 2]
- evidence: Explore 调研 badge.tsx:10-21 硬编码;--success/--warning 变量未映射

## D-006@v1: 双库边界(shadcn vs antd)
- type: architecture
- status: accepted
- source: user+architect
- priority: P0
- question: 方案 B 引入 shadcn,如何避免与 antd 双库混乱?
- answer: 硬约束分层——shadcn 负责纯视觉/布局/展示(Button/Card/Badge/Tag/Avatar/Skeleton/Tooltip/Dropdown/Dialog/EmptyState),antd 负责复杂业务/数据(Table/Form/DatePicker/Select/Modal/Drawer/Tabs/Cascader/Pagination);antd 业务组件通过 ConfigProvider token 调到视觉贴近 shadcn Card;回退方案 A
- normalized_requirement: 组件选型按边界表;不得用 shadcn 替换 antd 业务组件;antd Table/Form token 深度定制
- impacts: [P3, P1, R-02, 验收 6]
- evidence: 用户 step8 选方案 B;架构师双库边界策略
