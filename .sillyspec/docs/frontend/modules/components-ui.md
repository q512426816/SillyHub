---
schema_version: 1
doc_type: module-card
module_id: components-ui
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 设计系统原语组件（components-ui）

## 定位
设计系统底层原语组件（shadcn 风格），位于 `components/ui/`，当前 12 个原语文件：avatar、badge、button、card、confirm-captcha、dialog、dropdown-menu、empty-state、input、json-editor、markdown-text、status-badge（Skeleton/Tag/Tooltip 已删）。基于 Radix UI + Tailwind + `class-variance-authority`（cva），是所有上层业务组件与页面的样式交互原子。与 antd 并存：antd 管复杂表单/表格，ui/* 管轻量展示态控件与统一视觉。

## 契约摘要
- `Button` / `Input` / `Badge` / `Avatar` / `Card` / `Dialog` / `DropdownMenu`：cva 变体原语，forwardRef 透传（Dialog/DropdownMenu 为 Radix 组合导出多子件）。
- `EmptyState`：props `{ icon?, title, description?, action? }`——统一"暂无数据"占位（纯视觉，不绑 antd Table emptyText）。
- `StatusBadge`：`StatusKind = info|success|warning|error|neutral`；内部渲染为 antd Badge（kind→status 映射：info→processing 蓝脉冲 / success→success / warning→warning / error→error / neutral→default），调用方拿 kind 即定色。
- `ConfirmCaptcha`：props `{ onVerified: (token) => void }`——点按式人机确认：点「我不是机器人」→ 取一次性 captcha_id → 校验换 captcha_token 回调；失败可重试。防爆破主力在后端 IP 限流。
- `JsonEditor`：受控 JSON 文本编辑（`value/onChange`，非法 JSON 期间也回调不丢输入；`placeholder?`、高度行数）。
- `MarkdownText`：紧凑型 Markdown 渲染——`@uiw/react-markdown-preview` dynamic import + ssr:false，覆盖默认大字号为 text-xs，代码块横向滚动、链接新窗口、文字色继承父容器。

## 关键逻辑
```
// cva 变体模式（Button 为例，全模块统一范式）
const buttonVariants = cva('基础类', {
  variants: { variant: {...}, size: {...} },
  defaultVariants: { variant: 'default', size: 'default' },
})
export const Button = forwardRef((props, ref) =>
  <button ref={ref} className={cn(buttonVariants(props), props.className)} ... />)
// 样式合并统一走 lib-utils 的 cn（clsx + tailwind-merge），外部 className 可覆盖变体默认
```

## 注意事项
- 与 antd 控件混用选型：表单/表格/复杂交互优先 antd，纯展示/徽标/空态优先 ui/*，避免同一处两套样式打架；StatusBadge 内部就是 antd Badge，视觉已统一到 antd 配色。
- 改 cva 变体键值会级联所有引用处需全局回归；新增 variant 要同步 tailwind content 扫描配置。
- forwardRef 是约定，新原语务必透传 ref（antd Form/Tooltip 等需要）。
- MarkdownText 依赖浏览器 API，必须保持 ssr:false 的 dynamic import，勿改静态导入。
- ConfirmCaptcha 的 token 是一次性后端凭据，勿在前端缓存复用。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
