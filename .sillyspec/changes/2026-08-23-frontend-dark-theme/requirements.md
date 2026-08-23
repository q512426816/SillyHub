---
author: qinyi
created_at: 2026-08-23
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 用户（所有登录角色） | 白天/夜间使用平台的任何用户；主题为纯前端偏好，与权限无关 |

## 功能需求

### FR-01: 暗色主题（dark）全站可用
覆盖决策：D-003@v1, D-004@v1, D-006@v1

Given 用户处于任一页面（列表页/工作区/会话/监控/登录页）
When 切换到 dark 主题
Then 页面底、卡片、边框、表格、表单、弹窗、菜单、气泡、图表文字全部呈现暗色取值（bg=slate-900 系），无残留纯白大色块；品牌强调为亮紫（brand-600=#a78bfa 翻转阶）

Given dark 主题下的 antd 组件（Table/Menu/Tabs/Modal/Form 等）
When 渲染或交互（悬浮/选中/聚焦）
Then 组件灰阶经 darkAlgorithm 自动适配，选中/悬浮底为深紫（brand-50=#2e1065 翻转阶），文字对比度可读

### FR-02: 三主题切换控件与记忆
覆盖决策：D-001@v1

Given 顶栏主题切换按钮（Palette 图标）
When 点击
Then 弹出三选一菜单（AI 紫 / 明亮蓝 / 暗夜），当前项高亮；选择即时全站换肤（无 reload）

Given 用户已手动选择任一主题
When 刷新页面
Then localStorage `sillyhub-theme` 记忆生效，首帧即正确主题（无闪烁），持久化格式 `{"state":{"theme":"..."},"version":0}` 不变

### FR-03: 首次访问跟随系统明暗
覆盖决策：D-002@v1

Given localStorage 无 `sillyhub-theme` 记录（从未手动选择）
When 打开页面且系统为暗色模式（prefers-color-scheme: dark）
Then 首帧直接呈现 dark 主题（防闪烁脚本判定，React hydrate 后不回跳浅色）

Given localStorage 无记录且系统为浅色
When 打开页面
Then 默认 ai-native 主题（现状不变）

Given matchMedia 不可用或抛异常（旧浏览器/隐私模式）
When 打开页面
Then 回落 ai-native（与现状兜底口径一致）

### FR-04: 浅色两主题零回归
覆盖决策：D-004@v1, D-005@v1

Given blue 或 ai-native 主题
When 本变更上线后渲染任意页面
Then slate 阶 CSS 变量取值与现状逐值相等；bg-card 场景仍为纯白；斑马纹/spinner 等修正点在浅色下与现状视觉等值；观感与上线前一致

## 非功能需求

- 兼容性：已选 blue/ai-native 的老用户行为完全不变；脏值（非法主题名）兜底 ai-native 口径不变；`dark` 从非法值转为合法值
- SSR 安全：matchMedia 判定只在客户端执行（store merge 仅水合时跑、layout 脚本 try-catch 包裹），服务端渲染不受影响
- 可回退：dark 主题不选中即完全不可达；slate 变量化映射值与原 hex 逐值相等，回退仅需还原 tailwind 配置
- 可测试：themes.test.ts 断言取值完整性与翻转对称性；store/脚本跟随系统逻辑可单测；浏览器实测三主题清单（列表页/工作区/会话/图表页/登录页）

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02 | 暗色为第三主题，切换控件三选一，单键存储格式不变 |
| D-002@v1 | FR-03 | 无记录跟随 prefers-color-scheme，store 与 layout 脚本成对实现 |
| D-003@v1 | FR-01, FR-04 | 走扩展 data-theme 变量体系（方案 A），单一源铁律不破 |
| D-004@v1 | FR-01, FR-04 | 暗色取值=Tailwind 默认阶对称翻转 + 主色/语义提亮 |
| D-005@v1 | FR-04 | slate 阶变量化且浅色取值逐值相等 |
| D-006@v1 | FR-01 | antd dark 经 darkAlgorithm，token 继续查表不加分支 |
