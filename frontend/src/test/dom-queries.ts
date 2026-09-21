/**
 * 第三方库 / 全局样式结构查询的集中收口（ql-20260921-008-b962）。
 *
 * 背景：测试里曾散落 `.ant-modal-confirm` / `.ant-select-*` / `.ant-tree-*` /
 * `.echarts-for-react` / `.animate-spin` 等字面量查询——断言的是第三方库的
 * 内部 DOM 结构，antd 大版本升级或图表库替换时会成片碎掉。收拢到本文件后，
 * 升级时只需改这里，测试代码不动。
 *
 * 边界约定：
 * - 只收「第三方结构查询」，不收断言本身；
 * - 项目自有语义类（sh-* / seg-* / wdg-* 等）是稳定自有测试锚点，不入此文件；
 * - 设计契约守卫（bg-brand-600 语义阶、min-h-[44px] 触摸热区等）是对样式的
 *   有意断言，不经过本文件。
 */

/** antd Modal.confirm 二次确认弹层（portal 到 body，不在 render 容器内）。 */
export function queryAntdConfirm(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".ant-modal-confirm");
}

/** 确认弹层标题节点。 */
export function queryAntdConfirmTitle(confirmRoot: ParentNode): HTMLElement | null {
  return confirmRoot.querySelector<HTMLElement>(".ant-modal-confirm-title");
}

/** 从 Select 内任意元素向上取 Select 根节点。 */
export function closestAntdSelect(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>(".ant-select");
}

/** Select 的鼠标按下点击区：优先 content（展开态结构），回退 selector。 */
export function queryAntdSelectZone(root: ParentNode): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>(".ant-select-content") ??
    root.querySelector<HTMLElement>(".ant-select-selector")
  );
}

/** Select 悬浮态清除按钮。 */
export function queryAntdSelectClear(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(".ant-select-clear");
}

/** Select 多选模式结构（存在即多选）。 */
export function queryAntdSelectMultiple(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(".ant-select-multiple");
}

/** 从 Tree 行内任意元素向上取 treenode 行节点。 */
export function closestAntdTreeRow(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>(".ant-tree-treenode");
}

/** 从 Tree 行内任意元素向上取行内容点击区（整行点击命中节点）。 */
export function closestAntdTreeNodeWrapper(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>(".ant-tree-node-content-wrapper");
}

/** 从下拉选项内任意元素向上取选项行（rc-virtual-list 滚动容器内的 option 行）。 */
export function closestAntdSelectOption(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>(".ant-select-item-option");
}

/** 从徽标内容向上取 antd Badge 根。 */
export function closestAntdBadge(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>(".ant-badge");
}

/** 从 img 向上取 antd Image 包裹层（预览点击命中节点）。 */
export function closestAntdImage(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>(".ant-image");
}

/** Tree 行内图标 svg；传 lucide 形状名（如 "folder"）时按形状精确匹配。 */
export function queryAntdTreeIcon(row: ParentNode, lucide?: string): SVGElement | null {
  const suffix = lucide ? `.lucide-${lucide}` : "";
  return row.querySelector<SVGElement>(`.ant-tree-iconEle svg${suffix}`);
}

/** Tree 行展开/收起开关。 */
export function queryAntdTreeSwitcher(row: ParentNode): HTMLElement | null {
  return row.querySelector<HTMLElement>(".ant-tree-switcher");
}

/** antd Spin 加载指示。不传 root 时查全文档。 */
export function queryAntdSpin(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(".ant-spin");
}

/** antd Segmented 分段控制器根。不传 root 时查全文档。 */
export function queryAntdSegmented(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(".ant-segmented");
}

/** echarts-for-react 图表容器（图表已渲染的判据）。不传 root 时查全文档。 */
export function queryChart(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(".echarts-for-react");
}

/** Tailwind animate-spin 加载旋转元素（加载态判据）。不传 root 时查全文档。 */
export function querySpinner(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(".animate-spin");
}
