---
author: qinyi
created_at: 2026-08-20T10:00:00
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 所有登录用户，可切换蓝/AI 紫主题，偏好被记住 |
| 开发者 | 经 themes.ts 单一源取色，禁止散落 hex（含两套主题取值） |

## 功能需求

### FR-01: 主题注册表与 brand 语义色阶
覆盖决策：D-101@v1, D-003@v2
Given `themes.ts` 定义 `blue`/`ai-native` 两套完整 ThemeDef（radius/shadow/font/spacing 共享）
When 前端构建
Then `:root` 注入 ai-native 变量值 + brand 阶紫阶值，`[data-theme="blue"]` 覆盖为旧蓝值 + brand 阶蓝阶值；tailwind `brand-*` 类经 `var(--color-brand-*))` 消费，切主题即变色
And 两套主题 color 键集合完全一致（单测断言），brand 阶 50-950 十一档齐全

### FR-02: 主题切换与持久化
覆盖决策：D-101@v1, D-102@v1
Given 用户在任一页面
When 点击顶栏主题切换按钮
Then `<html data-theme>` 与 antd token 同步切换，全站即时生效；`localStorage["sillyhub-theme"]` 写入偏好
When 刷新页面 / 新开标签
Then 首帧渲染前 inline script 读偏好设 data-theme，无主题闪烁（白屏蓝→紫跳变）
When localStorage 无值或值非法
Then 兜底 `ai-native`

### FR-03: antd 主题动态跟随
覆盖决策：D-101@v1
Given antd ConfigProvider token/components 改从 `useThemeStore` 当前主题取
When 切换主题
Then antd 组件（按钮/菜单选中/表格头/Tabs/Tag/Badge 等）跟随变色，无散落 hex

### FR-04: 蓝色清扫
覆盖决策：D-003@v2
Given 198 处 `bg/text/border-blue-*`（56 文件）与 17 处 hex 及登录页渐变、kanban PALETTE、globals.css spinner 蓝
When 执行清扫
Then 品牌用途（含全部浅档）改 `brand-*` 类或主题引用；真信息蓝保留 blue 阶（逐一判断）；grep 复核模式 `bg-blue|text-blue|border-blue|#2563eb|#3b82f6|rgba(22, 119, 255` 品牌用途清零
And 9 文件 `message.xxx` 裸调迁移 `useNotify()`，grep `message.*from "antd"` 复核无残留（迁移范围核对用，具名导入逐文件确认）
And tokens.ts 删除，9 处消费方全部迁 themes.ts，tsc 无断链

### FR-05: 会话页 AI 原生细节
覆盖决策：D-004@v1
Given /sessions 聊天流（turn-timeline 等）
When SSE 流式输出进行中
Then 末尾显示闪烁光标；等待首个响应块时显示 typing 三点指示；上下文引用以 chip 样式展示（数据源=turn 快照 whoLine，无自然接入位则仅交付样式组件）
And `prefers-reduced-motion` 下全部动效退化为直接呈现
And SSE 数据流/协议/状态机零改动

### FR-06: blue 主题原样平移
覆盖决策：D-102@v1, D-003@v2
Given 用户切回 blue 主题
When 逐页核对核心页（工作区/会话/PPM 表格/登录/kanban）
Then 主色/选中态/表格头/卡片边框/按钮/徽章色与重构前同页一致（语义色位逐项核对，不要求像素 diff）
And 例外：info 状态徽标为 accent 青（非旧蓝，跨主题语义一致）

## 非功能需求

- 兼容性：未设偏好新用户默认 ai-native；老偏好不存在时兜底；SSR 首帧不闪烁
- 可回退：`DEFAULT_THEME` 改回 `blue` + 移除 ThemeToggle 即回现版观感（token 层结构不变）；无 API/表结构/SSE 变更
- 可测试：themes 结构一致性/切换持久化有 vitest 单测；清扫结果 grep 可复核；两主题截图对照可验收

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-101@v1 | FR-01, FR-02, FR-03 | 主题机制=注册表+state+html 属性双驱动 |
| D-102@v1 | FR-02, FR-06 | 默认 ai-native + localStorage key + 防闪烁 |
| D-003@v2 | FR-01, FR-04, FR-06 | brand 语义阶 + 清扫原则 + info 例外 |
| D-004@v1 | FR-05 | 会话页细节仅表现层 |

> 沿用 2026-06 变更决策（D-001@v1 暗色非目标 / D-005@v1 状态五档 / D-006@v1 双库边界）在 design §3/§11 引用，不重复立项。
