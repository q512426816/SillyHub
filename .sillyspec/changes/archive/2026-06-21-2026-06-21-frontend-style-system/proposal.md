---
author: qinyi
created_at: 2026-06-22T00:13:03
---

# Proposal — 前端样式系统重设计

## 动机
用户反馈前端"太丑"。根因:无统一设计系统——antd 主题仅定制 3 token、主色三套并存、状态色双轨+硬编码、间距圆角容器无规范、缺视觉层次、emoji 图标、登录页独立宇宙。

## 关键问题(现有方案为何不够)
1. **主色三套打架**:同一屏 3 种蓝(antd `#1e3a5f` / Tailwind `#20437a` / 登录页 `#1a2a6c`)+ antd 默认蓝 `#1677ff`,无品牌色统一
2. **antd 默认皮肤与 Tailwind 手搓卡片同框**:主题只动 3 token,antd 组件保持默认观感,与 Tailwind 卡片风格不统一
3. **无设计规范**:max-w 四种、padding 混用、圆角三套、状态色双轨,各页各写各的

## 变更范围
建立 Design Token 单一源 + antd/Tailwind 双消费 + shadcn 视觉组件(方案 B)+ 共享布局组件 + AppShell 重做 + 逐页适配 + 登录页重做 + 动效。确立"现代明亮活力"视觉语言。

## 不在范围内(显式)
- 暗色模式(D-001)
- 替换 antd 业务组件(Table/Form/DatePicker 等)
- 改业务逻辑/数据流/API
- 移动端响应式
- 新状态管理/路由

## 成功标准(可验证)
- 散落蓝 5 种 → 单一 `#2563eb`(grep)
- 状态色双轨 → 统一 StatusBadge
- max-w 四种 → 统一 PageContainer
- emoji 图标 → lucide
- 登录页深蓝紫 → 同色系明亮
- antd ConfigProvider token 全面定制(>3)
- tsc 通过 + Docker rebuild 实测核心页 + 截图对比原型
