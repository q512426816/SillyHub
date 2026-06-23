---
schema_version: 1
doc_type: module-card
module_id: components-ui
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:00
---
# components-ui

## 定位
设计系统底层原语组件（shadcn 风格），位于 `components/ui/*.tsx`。基于 Radix UI + Tailwind + `class-variance-authority`（cva）实现，是所有上层业务组件（components-shared/layout/daemon/agent-log 等）与页面的样式与交互原子。与 antd 并存：antd 用于复杂表单/表格，ui/* 用于轻量展示态控件与统一视觉。

## 契约摘要
- `Button`：cva 变体（variant + size），`forwardRef`，`ButtonProps extends ButtonHTMLAttributes + VariantProps`。
- `Badge`：cva variant，纯展示标签。
- `Input`：受控/非受控输入框，forwardRef。
- `Card`：卡片容器（header/content/footer 子结构）。
- `Dialog` / `DropdownMenu`：基于 Radix 的对话框/下拉菜单原语。
- `Avatar` / `Tooltip` / `Tag` / `Skeleton`：对应展示/占位原语。
- `EmptyState`：props `{ icon?, title, description?, action? }`，统一的"暂无数据"占位（圆形图标 + 文案 + 可选操作）。
- `StatusBadge`：`StatusKind = info|success|warning|error|neutral`，带状态点（dot）的状态徽标，支持 `size: sm|md`，内部用 `VARIANT_STYLES` / `SIZE_STYLES` / `DOT_SIZE_STYLES` 映射样式。

## 关键逻辑
- cva 变体模式（Button 为例）：
  ```
  const buttonVariants = cva('基础类', {
    variants: { variant: {...}, size: {...} },
    defaultVariants: { variant:'default', size:'default' },
  })
  export const Button = forwardRef<...>((props, ref) =>
    <button ref={ref} className={cn(buttonVariants(props), props.className)} ... />)
  ```
- 样式合并统一走 lib-utils 的 `cn`（clsx + tailwind-merge），保证外部 className 能覆盖变体默认。

## 注意事项
- 这些原语与 antd 控件混用，选型上：表单/表格/复杂交互优先 antd，纯展示态/徽标/空态优先 ui/*，避免同一处两套样式打架。
- 改 cva 变体键值会级联到所有引用处，需全局回归；新增 variant 要同步 tailwind 内容扫描配置（content glob）。
- StatusBadge 的 dot 视觉是其辨识点，改 size 时三组样式映射（VARIANT/SIZE/DOT_SIZE）要一起改。
- forwardRef 是约定，新原语务必透传 ref 以兼容 antd Form/Tooltip 等需要 ref 的场景。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
