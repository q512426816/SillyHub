---
author: qinyi
created_at: 2026-06-22T00:13:03
---

# Requirements — 前端样式系统重设计

## 角色
| 角色 | 说明 |
|---|---|
| 项目管理员/成员 | 使用 PPM/主平台各页的后台用户 |
| 前端开发者 | 按设计系统开发新页 |

## 功能需求

### FR-01: Design Token 单一源
覆盖:D-004@v2, D-005, D-006
- Given `tokens.ts` 定义完整色板/圆角/阴影/字体
- When antd ConfigProvider 与 Tailwind config 均消费 tokens
- Then 改 token 全局生效,antd 与 Tailwind 视觉收敛

### FR-02: 统一"现代明亮活力"视觉
覆盖:D-005
- Given 主色 `#2563EB` + cyan/emerald + slate + 圆角 12 + 柔和阴影 + Inter
- When 渲染任意页面
- Then 不再出现 `#1e3a5f`/`#20437a`/`#1a2a6c`/`#1677ff`/`#3b82f6` 散落蓝(grep 为空)

### FR-03: 统一状态语义色
覆盖:D-005
- Given `StatusBadge(kind)` 组件
- When 展示任意状态(进行中/完成/待验收/延期/未开始)
- Then 走统一语义 token,无硬编码 emerald/amber/red

### FR-04: 共享布局组件
- Given PageContainer/PageHeader/SectionCard/DataTable
- When 页面使用这些组件
- Then max-w/padding/圆角统一,无 4 种容器写法

### FR-05: AppShell 升级
覆盖:D-003
- Given 侧边栏 + 新增顶栏
- When 渲染 dashboard
- Then 菜单图标用 lucide(无 emoji),顶栏含面包屑/全局搜索/通知/用户菜单

### FR-06: 登录页同色系
覆盖:D-002
- Given 登录页重做
- When 访问 /login
- Then 明亮蓝同色系 hero,无孤立深蓝紫 `#1a2a6c`

### FR-07: Inter 字体
覆盖:D-004@v2
- Given `@fontsource/inter` + `next/font/local`
- When 页面加载
- Then 使用 Inter,系统字体降级兜底,构建不依赖外网

## 非功能需求
- 兼容性:项目未上线,无版本兼容负担(CLAUDE.md 规则 7)
- 可回退:方案 B 可回退方案 A(token 层 P0-P2 通用)
- 可测试:grep 验证配色统一、tsc 通过、Docker rebuild 实测
- 性能:shadcn copy-in 按需,字体 self-host,无明显包体积恶化

## 决策覆盖矩阵
| 决策 ID | 覆盖 FR | 说明 |
|---|---|---|
| D-001@v1 | 非目标 | 暗色模式排除 |
| D-002@v1 | FR-06 | 登录页同色系 |
| D-003@v1 | FR-05 | lucide 图标 |
| D-004@v2 | FR-01, FR-07 | Inter @fontsource |
| D-005@v1 | FR-01, FR-02, FR-03 | 状态色统一 |
| D-006@v1 | FR-01 | 双库边界 |
| D-004@v1 | — | superseded by D-004@v2(Inter self-host v1) |

> 所有当前版本 D-xxx@vN 均被覆盖,D-004@v1 已被 D-004@v2 取代,无剩余风险。
