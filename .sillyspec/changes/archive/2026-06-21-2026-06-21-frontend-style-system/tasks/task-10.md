---
id: task-10
title: 登录页重做(同色系明亮 hero)
status: pending
priority: P1
depends_on: [task-05, task-07]
blocks: [task-11]
covers: [FR-06, D-002@v1]
allowed_paths:
  - frontend/src/app/(auth)/login/page.tsx
created_at: 2026-06-22T00:18:09
author: qinyi
---

## 背景

前端样式系统重设计的 task-10。登录页 `frontend/src/app/(auth)/login/page.tsx` 是"独立宇宙":左半屏用深蓝紫渐变(`#0f1b4c` 底 + `from-[#1a2a6c] via-[#2d4ea8] to-[#5b7ed8]`)、装饰光球、手写 SVG 多彩插画(`#ffbd00/#84a9ff/#ff654f/#5bd17f` 四色圆点);右半屏白卡片 + antd Form,且引入了与主应用无关的第三套 `text-neutral-800/900/500` 灰阶。整套配色与主应用 `#1e3a5f`/Tailwind 语义色零关联,违反 D-002 同色系一致性。

重做为明亮蓝同色系(与主应用统一):左半屏 hero 用 blue 系柔和渐变 + 品牌标识;右半屏表单用 shadcn `Card`(task-05 产物)包裹 antd Form(保留 antd Form,D-006 业务组件边界)。消除全部孤立硬编码色与第三套 neutral 灰阶。

### 现状(已确认 frontend/src/app/(auth)/login/page.tsx)

- L69 `main`:`bg-[#0f1b4c]` 深蓝底 + `text-white`,需改为明亮同色系底
- L75 左侧 hero 渐变:`from-[#1a2a6c] via-[#2d4ea8] to-[#5b7ed8]`,需换为 blue/cyan token 渐变
- L80/84 装饰光球:`bg-white/10`、`bg-[#84a9ff]/30`,需改为 blue token 透明球
- L106 右侧表单区:`bg-white` + `text-neutral-800 dark:bg-[var(--login-bg-color)]`,引入 neutral 灰阶需改 slate token
- L111/115/116:`text-neutral-900`、`text-neutral-500`,需换 slate token
- L218-221 SVG 插画四色圆点:`#ffbd00/#84a9ff/#ff654f/#5bd17f`,违反同色系,需改为 blue/cyan 同色系
- L121-179 antd Form:登录业务逻辑(onFinish/login API/REMEMBER_KEY/localStorage/router.replace)完整,必须保留不动
- LogoMark(L187-193):`bg-white/15 text-white` 深底白字,需适配明亮 hero 底

## 实现要点

### 1. 左侧 hero(明亮蓝同色系)

- `main` 底色:从 `bg-[#0f1b4c]` 改为明亮底(如 `bg-slate-50` 或同色系浅底)
- hero 渐变(L75):`from-blue-600 via-blue-500 to-cyan-500`(或 `from-blue-50 via-white to-cyan-50` 柔和浅版),严禁 `#1a2a6c/#2d4ea8/#5b7ed8/#0f1b4c` 任一色值
- 装饰光球(L80/84):`bg-[#84a9ff]/30` → `bg-blue-400/20` 或 `bg-cyan-300/20`;`bg-white/10` 保留或改 `bg-blue-200/30`,统一同色系
- logo + 系统标题(L88-91):保留 SillyHub 文案,LogoMark 配色适配明亮底(深蓝字 `text-blue-600` 或同色系),保持品牌识别
- 欢迎语 + 插画(L94-102):文案"欢迎使用 SillyHub / 多智能体协作平台 · 知识沉淀 · 规格驱动开发"保留,文字色适配明亮底(如 `text-slate-900`/`text-slate-600`),不再用 `text-white`
- 插画 SVG(L196-240):四色圆点 `#ffbd00/#84a9ff/#ff654f/#5bd17f` 改为 blue/cyan 同色系(如 `blue-400/cyan-400/sky-400/indigo-400` token 或同色系 hex),几何形状可保留

### 2. 右侧表单(shadcn Card + antd Form)

- 引入 task-05 的 `Card`/`CardHeader`/`CardTitle`/`CardContent`(确认 task-05 已 export,允许 import)
- 表单区底色(L106):`bg-white text-neutral-800` → slate token(`bg-white text-slate-800` 或 `bg-slate-50`),删除 `dark:bg-[var(--login-bg-color)]`(无定义变量)
- 表单卡片:用 `<Card>` 包裹现有 antd Form,Card 本身走 task-05 的 `border-slate-200` token
- 标题区(L114-119):`text-neutral-900/text-neutral-500` → `text-slate-900/text-slate-500`
- 移动端 logo(L111):`text-neutral-900` → `text-slate-900`
- 主色统一:antd Button `type="primary"` 的主色通过 antd ConfigProvider/theme token 设为 `#2563EB`(若 task-07 已设全局 token 则直接生效;否则本页不额外配置,依赖全局)。本任务不硬编码覆盖 antd primary 色

### 3. 保留不动(边界)

- `login` API 调用(L44)、`ApiError` 处理、`REMEMBER_KEY` localStorage 读写(L26-58)、`router.replace("/workspaces")`(L60)、antd Form 及其 `rules` 校验(L133-157)、initialValues、submitting/error 状态机 —— 全部原样保留

## 边界

1. 不改登录业务逻辑(login API/token 存储与读取/跳转目标/记住我缓存 全保留原样)
2. 保留 antd Form 及其校验 rules(D-006 业务组件边界,Form/FormItem/Input/Input.Password/Checkbox 不替换为 shadcn)
3. 同色系不引入主应用外的孤立配色(消除 `#1a2a6c/#2d4ea8/#5b7ed8/#0f1b4c/#84a9ff` 与 SVG 四色点,统一 blue/cyan/slate token)(D-002)
4. hero 渐变用 blue/cyan token(`from-blue-600 via-blue-500 to-cyan-500` 或同色系浅版),不硬编码 hex
5. 响应式桌面优先,登录页保持基本可用(`lg:flex` 断点 + 移动端 logo 兜底保留,不做完整移动端适配)

## 非目标

- 不改登录 API 调用与返回处理
- 不改 token 存储机制
- 不做完整移动端适配(仅保持登录页基本可用)
- 不替换 antd Form 为 shadcn Form(D-006)
- 不改 antd 全局 theme token(若 task-07 未覆盖,本任务不额外补)

## 依赖说明

- 依赖 task-05:复用其 `Card`/`CardHeader`/`CardTitle`/`CardContent` 组件包右侧表单卡片
- 依赖 task-07:复用其布局/全局 token(若 task-07 设了 slate token 与 primary 色,本页直接消费)
- 阻塞 task-11:登录页样式定稿后,task-11(全站视觉验收)才能统一对照

## 验收

| AC | 判据 |
|----|------|
| AC-01 | 全文件无 `#1a2a6c`/`#2d4ea8`/`#5b7ed8`/`#0f1b4c` 硬编码(grep 零命中) |
| AC-02 | 左侧 hero 渐变使用 blue/cyan 同色系 token(`from-blue-* via-blue-* to-cyan-*` 或同色系浅版),SVG 插画圆点改为同色系 |
| AC-03 | antd Form(`<Form>`/`Form.Item`/`Input`/`Input.Password`/`Checkbox`)保留且 rules 校验功能正常,登录提交链路不变 |
| AC-04 | 主色统一 `#2563EB`(antd primary 走全局 token 或 task-07 配置,本页不另设;页面无冲突的 primary 色硬编码) |
| AC-05 | `npx tsc --noEmit -p frontend` 通过,无类型错误 |
