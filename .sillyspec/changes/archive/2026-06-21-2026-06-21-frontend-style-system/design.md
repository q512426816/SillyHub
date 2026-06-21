---
author: qinyi
created_at: 2026-06-22T00:01:02
---

# design.md — 前端样式系统重设计(现代明亮活力)

> 变更 `2026-06-21-frontend-style-system` · 方案 B(Token 单一源 + shadcn 视觉组件 + antd 业务组件)
> 原型 `prototype-frontend-style-system.html`

## 1. 背景

用户反馈前端"太丑"。调研(Explore)定位根因——无统一设计系统:

- antd 主题仅定制 3 个 token(colorPrimary/borderRadius/fontSize),antd 基本停在默认皮肤
- 主色三套并存打架:antd `#1e3a5f` / Tailwind `#20437a` / 登录页 `#1a2a6c→#5b7ed8`,外加看板 antd 默认蓝 `#1677ff`、Tailwind `#3b82f6`
- 状态色双轨:antd Tag 预设色 vs shadcn Badge variant(硬编码 emerald/amber),语义不互通;`--success/--warning` 变量定义了却没被 Tailwind 映射也没被组件用
- 间距/圆角/容器宽度无规范:max-w 四种写法、padding 混用、圆角 antd4/Tailwind6/login12 三套
- 缺视觉层次:无顶栏/面包屑、Card 是最低成本 `rounded border bg-card p-3`(无阴影/hover/分区)
- 图标低质:侧边栏用 emoji 字符(`🚪`/`→←`),lucide 已装几乎未用
- 登录页独立宇宙(深蓝紫渐变+SVG),与主应用零关联

## 2. 设计目标

- 建立**单一真实源** Design Token 层,antd 与 Tailwind 双消费,改 token 全局生效
- 确立"现代明亮活力"视觉语言:明亮蓝主色 `#2563EB` + cyan/emerald 辅色 + slate 中性 + 圆角 12 + 柔和阴影 + Inter
- 统一状态语义色(Tag/Badge 共享 StatusBadge)
- 统一布局/容器/间距/圆角规范(共享 PageContainer/PageHeader/SectionCard/DataTable)
- AppShell 升级:侧边栏 lucide 图标 + 新增顶栏(面包屑/全局搜索/用户菜单)
- 登录页收敛到同色系

## 3. 非目标

- ❌ 暗色模式(本轮专注亮色,token 预留扩展;D-001)
- ❌ 替换 antd 复杂业务组件(Table/Form/DatePicker/Select/Modal/Drawer/Tabs/Cascader/Pagination)——保留 antd,仅 token 调视觉
- ❌ 不改业务逻辑/数据流/API
- ❌ 不做响应式移动端适配(后台桌面为主)
- ❌ 不引入新状态管理/路由变更

## 4. 拆分判断

单一变更,不拆分、不批量。理由:统一设计系统改造(token→主题→组件→页面)是连贯整体;改 token 后 antd 组件+Tailwind 语义变量大量页面自动受益,仅硬编码处需逐处改;多页面适配由 plan 阶段 Wave 分组管理。

## 5. 总体方案(分 Phase,plan 细化为 Wave)

| Phase | 内容 | 类型 |
|---|---|---|
| P0 | Token 层 `src/styles/tokens.ts` + CSS 变量(色板/圆角/阴影/间距/字号);Inter self-host(`next/font/local`+woff2,D-004) | 地基 |
| P1 | antd 主题 `antd-providers.tsx` ConfigProvider 全面定制(colorPrimary/Success/Warning/Error/Info/borderRadius/fontFamily/fontSize/colorBgLayout + Table/Card/Modal/Tabs/Menu 组件 token);删 globals.css 原生 table 无效覆盖 | 地基 |
| P2 | Tailwind 映射 `tailwind.config.ts`(colors/fontFamily/boxShadow/borderRadius/animation);`globals.css` 重构(语义变量对齐 token,删冗余,补滚动条/focus) | 地基 |
| P3 | shadcn 视觉组件 copy-in `components/ui/*`(Button/Card/Badge/Tag/Avatar/Skeleton/Tooltip/Dropdown/Dialog/EmptyState)+ StatusBadge(D-005) | 核心 |
| P4 | 共享布局 `components/layout/*`(PageContainer/PageHeader/SectionCard/DataTable/SearchBar/FormLayout) | 核心 |
| P5 | AppShell 重做 `app-shell.tsx`:侧边栏 lucide(D-003)+ 菜单分组样式 + 新增顶栏 | 核心 |
| P6 | 逐页适配:看板(PALETTE→token、状态点→StatusBadge)、列表(统一容器/消除内联 width/统一 Button)、拓扑(色阶→brand)、milestone/work-hour | 渐进 |
| P7 | 登录页重做(D-002):深蓝紫独立宇宙→明亮蓝同色系 hero + shadcn Card + antd Form | 核心 |
| P8 | 动效(fade/hover-lift/skeleton/modal 过渡)+ 收尾(滚动条/focus/reduced-motion/清理冗余 CSS) | 收尾 |

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/styles/tokens.ts` | Design Token 单一源 |
| 新增 | `frontend/src/styles/fonts.ts` | Inter self-host(next/font/local) |
| 新增 | `frontend/package.json` 加 `@fontsource/inter` | npm 包提供 Inter woff2(免手动下载) |
| 新增 | `frontend/src/components/ui/{button,card,badge,tag,avatar,skeleton,tooltip,dropdown,dialog,empty-state}.tsx` | shadcn 视觉组件(copy-in) |
| 新增 | `frontend/src/components/ui/status-badge.tsx` | 统一状态语义 badge |
| 新增 | `frontend/src/components/layout/{page-container,page-header,section-card,data-table,search-bar,form-layout}.tsx` | 共享布局组件 |
| 新增 | `frontend/src/components/top-bar.tsx` | 顶栏(面包屑/搜索/通知/用户菜单) |
| 修改 | `frontend/src/components/antd-providers.tsx` | ConfigProvider 全面定制 token |
| 修改 | `frontend/src/components/app-shell.tsx` | 侧边栏 lucide + 接入顶栏 |
| 修改 | `frontend/tailwind.config.ts` | 扩展 colors/fontFamily/boxShadow/borderRadius/animation |
| 修改 | `frontend/src/app/globals.css` | 重构语义变量 + 删冗余 + 补滚动条/focus |
| 修改 | `frontend/src/app/layout.tsx` | 接入 Inter 字体 |
| 修改 | `frontend/src/app/(auth)/login/page.tsx` | 重做同色系明亮 hero |
| 修改 | `frontend/src/app/(dashboard)/ppm/kanban/page.tsx` + `_components/*` | PALETTE→token、状态点→StatusBadge |
| 修改 | `frontend/src/app/(dashboard)/ppm/{project-plans,task-plans,milestone-details,work-hour-statistics}/page.tsx` | 统一容器/消除内联 width |
| 修改 | `frontend/src/components/ppm-resource-table.tsx` | 复用共享组件 + 消除硬编码 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/components/topology/page.tsx` | Tailwind 默认色阶→brand |

> ⚠️ P6 逐页适配具体页面较多,plan 阶段按 Wave 精确枚举。

## 7. 接口定义(Token/组件关键签名)

```ts
// tokens.ts —— 单一真实源(节选)
export const tokens = {
  color: { primary: '#2563eb', cyan: '#06b6d4', emerald: '#10b981',
           success: '#10b981', warning: '#f59e0b', error: '#ef4444', info: '#2563eb',
           bg: '#f8fafc', card: '#ffffff', border: '#e2e8f0' /* + blue/slate 全阶 */ },
  radius: { sm: '6px', md: '8px', lg: '12px', xl: '16px' },
  shadow: { sm: '...', md: '...', lg: '...' },
  font:   { sans: 'Inter, ...' },
} as const

// StatusBadge —— 状态语义统一入口(D-005)
type StatusKind = 'info' | 'success' | 'warning' | 'error' | 'neutral'
export function StatusBadge({ kind, children }: { kind: StatusKind; children: ReactNode })
```

> 无后端接口/DTO 变更。

## 8. 数据模型

不涉及(纯前端样式,无表结构/字段变更)。

## 9. 兼容策略(brownfield)

- 项目未上线,无版本兼容负担(CLAUDE.md 规则 7)
- 迁移过渡期:硬编码色/内联 style 在 P6 逐页替换,替换前不影响功能,仅视觉不统一
- 回退路径:方案 B 若双库维护成本过高,回退方案 A(撤回 shadcn 组件,保留 token+antd 定制层)—— P0-P2 在两方案通用

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | Inter 字体文件缺失 / Docker 构建拉取失败 | P1 | `@fontsource/inter` npm 包提供 woff2(node_modules,免手动下载/外网);`next/font/local` 指向包内文件;系统字体栈降级(D-004@v2) |
| R-02 | 方案 B 双库并存导致风格不收敛 | P1 | 双库边界硬约束(D-006);antd 业务组件 token 调到贴近 shadcn Card;回退 A |
| R-03 | 看板 PALETTE/状态点硬编码遍布,迁移遗漏 | P2 | P6 grep 全量扫 `#xxxxxx`/`PALETTE`/`style={{` 兜底,verify 抽查 |
| R-04 | antd token 调整撑破现有页面布局 | P2 | token 取值保守,逐 Wave 改后 Docker 实测 |
| R-05 | Docker 前端不热重载,需 rebuild 实测 | P2 | verify 阶段 rebuild + curl/截图,不只靠 tsc |

## 11. 决策追踪

见 `decisions.md`。当前版本决策均被本文覆盖:D-001@v1(暗色非目标,§3)/D-002@v1(登录页同色系,P7)/D-003@v1(lucide 图标,P5)/D-004@v1(Inter self-host v1,已被 D-004@v2 取代)/D-004@v2(@fontsource,P0/R-01)/D-005@v1(状态色统一,P1/P3)/D-006@v1(双库边界 P0,P3)。

## 12. 自审

| 检查项 | 结果 |
|---|---|
| 需求覆盖(现代明亮活力/专注亮色/全站统一/方案B) | ✅ |
| decisions 引用(D-001~D-006) | ✅ 均引用 |
| 约束一致(CONVENTIONS:Tailwind utility-first/clsx+twMerge/use client) | ✅ 沿用,shadcn 用 cn() |
| 真实性(路径/类名) | ✅ 来自 Explore 真实路径;新增标注"新增" |
| YAGNI | ✅ 非目标明确 |
| 验收标准具体可测 | ✅ 见下 |
| 生命周期契约表 | ⬜ 不适用(纯前端样式,无 session/lease/daemon/lifecycle) |
| 兼容/回退 | ✅ 回退方案 A;token 层通用 |

**验收标准**(verify 对照):
1. 散落蓝 `#1e3a5f`/`#20437a`/`#1a2a6c`/`#1677ff`/`#3b82f6` → 单一 `#2563eb`(grep 验证)
2. 状态色 Tag 预设/Badge 硬编码 → 统一 StatusBadge 语义 token
3. max-w 四种写法 → 统一 PageContainer
4. 侧边栏 emoji → lucide
5. 登录页深蓝紫 → 同色系明亮
6. antd ConfigProvider token 全面定制(非仅 3 个)
7. `tsc` 通过 + Docker rebuild 实测核心页(看板/列表/登录/工作区)+ 截图对比原型
