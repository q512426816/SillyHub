---
author: WhaleFall
created_at: 2026-07-20T10:42:00
---

# 前端页面样式规范(以 /ppm/projects 为基准)

> 本规范以 `/ppm/projects` 当前样式为**唯一基准**,后续新建或改造其它列表/管理页一律对齐。
> 基准组件:`PpmResourceTable`(`frontend/src/components/ppm-resource-table.tsx`,通用 CRUD 表格)+ `projects/page.tsx`(页面配置)。
> 设计系统总纲(token/主题来源):`.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/design.md`。

## 0. 一句话原则

- **UI 组件全用 antd**(Button / Form / Table / Modal / Tag / Badge / Select / DatePicker / Input / InputNumber)。
- **布局/间距/字号/颜色用 tailwind class**(`flex` / `grid` / `gap-*` / `text-*` / `bg-*`)—— tailwind 是样式工具,不是 shadcn,保留。
- **页面骨架用共享 layout 组件**(`PageContainer` / `PageHeader` / `SectionCard` / `DataTable`),不自己堆 div。
- **颜色不硬编码 hex**,走 antd token(主题)或 tailwind CSS 变量(`--background` / `--card` / `--muted` …)。
- **状态用 antd Badge(status)**,**分类用 antd Tag(color)**,空值统一 `—`。

---

## 1. 页面骨架

每个列表/管理页结构固定:

```
PageContainer(size="full")
├── PageHeader(title + subtitle)
├── SectionCard(bodyPadding="p-2")          ← 工具栏 + 搜索 + 表格包在一张卡片里
│   ├── 顶部工具栏(右对齐:导出/新增 | 竖分隔 | 搜索/重置/展开)
│   ├── 搜索 Form(grid-cols-4)
│   └── DataTable(antd Table)
├── 新建/编辑 Modal(条件渲染,drawer.open &&)
└── 删除确认 Modal(条件渲染)
```

```tsx
<PageContainer size="full">
  <PageHeader title="项目维护" subtitle="项目主数据,被成员/干系人/计划/看板引用" />
  <SectionCard bodyPadding="p-2">
    {/* 工具栏 + 搜索 + DataTable */}
  </SectionCard>
  {formOpen && <PpmResourceModal ... />}
  {confirmDelete && <DeleteConfirm ... />}
</PageContainer>
```

**规则**:
- 外层一律 `PageContainer`:列表页 `size="full"`(占满),表单页 `default`(1400px)或 `narrow`(420px)。
- 标题一律 `PageHeader`:主标题 `title`(必填)+ 副标题 `subtitle`(选填,一句话说明用途)。
- **禁止**自写 `<div className="max-w-... px-6 py-6">` 或 `<h1 className="text-2xl">`。

---

## 2. 顶部工具栏

位置:SectionCard 内顶部,`flex items-center justify-end gap-2 mb-2`(**右对齐**)。

按钮从左到右分两组,中间竖分隔:
1. **数据组**:导出(default)、+新增(primary)
2. **竖分隔**:`<span className="mx-1 h-6 w-px bg-border" aria-hidden />`
3. **基础组**(最右):搜索(primary)、重置(default)、展开/收起(default,仅字段>4 时显示)

```tsx
<div className="mb-2 flex items-center justify-end gap-2">
  {exportFn && (
    <Button disabled={exporting} onClick={handleExport} title={filename}>
      {exporting ? "导出中…" : "导出"}
    </Button>
  )}
  <Button type="primary" disabled={!canWrite} onClick={openCreate}>+ 新增{entityLabel}</Button>
  <span className="mx-1 h-6 w-px bg-border" aria-hidden />
  <Button type="primary" onClick={search}>搜索</Button>
  <Button onClick={reset}>重置</Button>
  {showExpandToggle && <Button onClick={toggle}>{expanded ? "收起" : "展开"}</Button>}
</div>
```

---

## 3. 搜索区

- 布局:`grid grid-cols-4 gap-3`(一行 4 个;字段>4 显示展开/收起,collapsed 取前 4)。
- 每个字段垂直布局(label 在上、控件在下):

```tsx
<div className="flex w-full flex-col gap-1">
  <span className="text-xs leading-4 text-muted-foreground">{label}</span>
  {/* antd Select / Input,包在 Form.Item name noStyle 里 */}
</div>
```

- 用 antd `Form` + `Form.Item name noStyle` 管控件(便于 `form.resetFields()` 清空)。
- **查询触发规则**:选择型(Select/日期)`onChange` 即查;文本型(Input)按**回车**或点**搜索按钮**才查 —— **不要每个按键都查**。

---

## 4. 数据表格(核心)

统一用 `DataTable`(antd Table 薄包装,见 `components/layout/data-table.tsx`)。关键配置:

| 项 | 值 | 说明 |
|---|---|---|
| `size` | `"small"` | 紧凑行高 |
| `bordered` | `true` | 单元格边框 |
| `scroll` | `{ x: "max-content", y: "calc(100vh - 430px)" }` | 横向滚 + 视口自适应高 |
| `striped` | 可选 | 斑马纹(奇行透明,偶行 `muted/0.4`) |
| `rowKey` | 唯一字段 | 通常 `id` |

**分页**:`showSizeChanger`、options `[10, 20, 50, 100]`、默认 20、`showTotal: t => 共 ${t} 条`,走后端真分页(注入 page/page_size)。

### 列定义规范

- **首列序号**:`title="#"` `width=56` `align="center"` `fixed="left"`,跨页连续 `(page-1)*pageSize + index + 1`。
- **数据列**:`align` 默认左;数字/状态/序号居中。
- **操作列(末列)**:`fixed="right"` `align="center"` `width=140`(有额外按钮 220),按钮包在 `<div className="flex justify-center gap-1">`。

### 固定列背景(防穿透)⚠️

**striped 表的固定列(序号 left + 操作 right)必须加 `onCell` 不透明背景**,否则横向滚动时中间列内容会穿透到固定列下方:

```tsx
onCell: () => ({ style: { background: "hsl(var(--card))" } })
```

`--card` 是 SectionCard 卡片底色,固定列与之同色才能正确遮挡(见 ql-20260720-004)。

### 单元格渲染

- **空值**:`<span className="text-xs text-muted-foreground">—</span>`(统一破折号,不留空白)。
- **主名字段**(如项目名):`<span className="font-medium text-foreground">{value}</span>`(加粗强调)。
- **日期**:格式化 `YYYY-MM-DD`(datetime 加 `HH:mm`)。
- **状态/类型**:见第 7 节。

---

## 5. 按钮规范

**全部用 antd `Button`**,不用 shadcn Button。

| 场景 | `type` | `size` | 备注 |
|---|---|---|---|
| 主操作(新增/搜索/保存/提交) | `primary` | 默认(middle,32px) | 蓝底白字 |
| 次要(导出/重置/展开/取消) | `default`(可省略) | 默认 | 边框 |
| 操作列(编辑/成员管理) | `link` | `small`(24px) | 文字链接,紧凑 |
| 删除/危险 | `link` + `danger` | `small` | 红色文字 |
| 保存中/加载中 | 加 `loading` | — | 文案保持动词原形,不写"…中" |

**规则**:
- 工具栏按钮用**默认 size(middle)**,**不要用 `small`**(small 24px 装不下 14px 字,字会顶边框,见 ql-20260720-002)。
- 操作列(表格行内)用 `small`,`link` 或 `link danger`。
- 文案中文动词;两字按钮 antd 会自动加字间距,正常现象。

---

## 6. 新建/编辑弹窗(Modal)

用 antd `Modal`(**不用 Drawer**)。`PpmResourceModal` 模板:

```tsx
<Modal
  open
  onCancel={onClose}
  title={mode === "create" ? `新增${entityLabel}` : `编辑${entityLabel}`}
  width={520}
  maskClosable={false}
  destroyOnClose
  footer={
    <div className="flex items-center justify-end gap-2">
      <Button onClick={onClose}>取消</Button>
      <Button type="primary" loading={saving} disabled={!canWrite} onClick={submit}>保存</Button>
    </div>
  }
>
  <Form form={formInst} layout="vertical" preserve={false}>
    {visibleFields.map(f => <Form.Item ...>...</Form.Item>)}
  </Form>
</Modal>
```

**规则**:
- `maskClosable={false}`(点遮罩不关,防误触丢数据)。
- `destroyOnClose`(关闭销毁,每次打开 Form 干净)。
- `Form layout="vertical"`(label 在上)。
- `Form.Item` 配 `rules`(`required`/`pattern`)+ `message`(中文提示)。
- **日期字段**:用 `getValueProps`/`normalize` 做 dayjs ↔ ISO 字符串双向转换(store 存字符串、控件用 dayjs),**不要手写 value/onChange**(会和 Form.Item 冲突崩,见 ql-20260714-007)。
- 底部:取消(default)+ 保存(primary + `loading`)。

---

## 7. 状态与分类标签

### 状态(进行中/已完成/已暂停…)

用 `StatusBadge` 组件(内部是 antd Badge),传 `kind`:

```tsx
<StatusBadge kind="info">进行中</StatusBadge>     {/* 蓝点 */}
<StatusBadge kind="success">已完成</StatusBadge>   {/* 绿点 */}
<StatusBadge kind="warning">已暂停</StatusBadge>   {/* 黄点 */}
<StatusBadge kind="error">已驳回</StatusBadge>     {/* 红点 */}
<StatusBadge kind="neutral">草稿</StatusBadge>     {/* 灰点 */}
```

或直接 antd Badge:`<Badge status="processing" text="进行中" />`。

`kind` ↔ antd status:`info→processing` / `success→success` / `warning→warning` / `error→error` / `neutral→default`。
状态文案 → kind 用 `fromStatus(label)` 自动推断(见 `components/ui/status-badge.tsx`)。

### 分类(项目类型/优先级…)

用 antd `Tag` + `color`:

```tsx
<Tag color="blue">研发项目</Tag>
<Tag color="cyan">实施项目</Tag>
<Tag>运维项目</Tag>        {/* color="default" 或不传 = 灰 */}
```

**禁止**硬编码 tailwind 色(`bg-emerald-500`/`text-amber-700` 等)或自写彩色 span。

---

## 8. 删除二次确认

用 antd `Modal`(**不用浏览器 `confirm()`**):

```tsx
<Modal open title={`确认删除${entityLabel}？`} onCancel={cancel} onOk={confirm}
  okText="确认删除" cancelText="取消" okButtonProps={{ danger: true }}
  maskClosable={false} destroyOnClose>
  <p className="mt-2 text-xs text-muted-foreground">
    将删除 <span className="font-mono">{label}</span>。该操作不可恢复。
  </p>
</Modal>
```

---

## 9. 提示与错误

- **成功/失败 toast**:用 antd `message`(经 `<AntApp>` 注入,走主题),不弹 `alert()`。
- **错误条**:加载失败时顶部红条 + 重新加载按钮:
  ```tsx
  <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
    {error}
    <Button className="ml-3" onClick={reload}>重新加载</Button>
  </div>
  ```
- **表单校验**:Form.Item 内联提示(rules message),不在顶部堆 banner。

---

## 10. 颜色 / 字号 / 间距

### 颜色(tailwind CSS 变量,主题自适应;勿硬编码 hex)

| 用途 | class | 值(light) |
|---|---|---|
| 页面底 | `bg-background` | #f8fafc |
| 卡片底 / 固定列背景 | `bg-card` / `hsl(var(--card))` | #ffffff |
| 主文字 | `text-foreground` | 深色 |
| 次要/label/空值 | `text-muted-foreground` | 灰 |
| 错误/危险 | `text-destructive` / `bg-red-50` | 红 |
| 分隔线 | `bg-border` | #e2e8f0 |

antd 组件主色/状态色由 `antd-providers.tsx` 的 token 统一(`colorPrimary` #2563EB 等),改色改 token,不在业务代码写 hex。

### 字号

| 用途 | class |
|---|---|
| 页面主标题 h1 | `text-2xl font-semibold tracking-tight`(PageHeader 自带) |
| 正文/表格 | 14px(antd 默认,不加 class) |
| label / 辅助 / 空值 | `text-xs` |
| 小注脚 | `text-[11px]` |
| 强调字段 | `font-medium` |

### 间距/圆角

- 卡片间距:`gap-4`(PageContainer)、`gap-2`(按钮组)、`gap-3`(搜索 grid)。
- 圆角:卡片 `rounded-lg`(SectionCard 自带),antd 组件圆角由 token(md=8 / lg=12)统一,不手写。

---

## 11. Do & Don't

✅ **Do**
- UI 组件用 antd;布局/间距/颜色用 tailwind class + CSS 变量。
- 页面用 `PageContainer` / `PageHeader` / `SectionCard` / `DataTable` 四件套。
- 状态用 `StatusBadge`/antd Badge,分类用 antd Tag color。
- striped 表的固定列加 `onCell` 背景防穿透。
- 日期用 `getValueProps`/`normalize` 双向转换。
- 按钮按场景选 type,工具栏用默认 size。

❌ **Don't**
- 不用 shadcn Button/Input/Card 等原装原件(已全换 antd)。
- 不自写 `<div max-w-...><h1 text-2xl>`(用 PageContainer/PageHeader)。
- 不硬编码 hex 色(用 token/CSS 变量)。
- 不用浏览器 `alert()`/`confirm()`(用 antd Modal/message)。
- 不手写 DatePicker `value`/`onChange`(会崩;用 Form.Item + getValueProps)。
- 不每键触发查询(文本输入按回车/按钮才查)。
- 工具栏按钮不用 `size="small"`(字顶边框)。

---

## 12. 迁移检查清单(改其它页面时逐项对照)

- [ ] 外层换成 `PageContainer` + `PageHeader`(去掉自写 max-w / h1)。
- [ ] 内容包进 `SectionCard`(`bodyPadding="p-2"` 配表格)。
- [ ] 表格换成 `DataTable`(`size="small" bordered scroll`,striped 可选)。
- [ ] 序号列 `align="center" fixed="left"`;操作列 `fixed="right" align="center"`。
- [ ] striped 表的固定列加 `onCell: () => ({ style: { background: "hsl(var(--card))" } })`。
- [ ] 按钮全换 antd Button,按场景选 type;工具栏去掉 `size="small"`。
- [ ] 抽屉(Drawer)换成 Modal(`maskClosable={false} destroyOnClose` footer 自定义)。
- [ ] 状态标签换 `StatusBadge`/antd Badge;分类换 antd Tag color。
- [ ] 删除确认换 antd Modal(去掉 `window.confirm`)。
- [ ] 日期字段改 `getValueProps`/`normalize`。
- [ ] 搜索区 `grid-cols-4` + Field 垂直布局 + 展开/收起。
- [ ] 空值显示 `—`(`text-muted-foreground`);主名 `font-medium`。
- [ ] grep 确认无 `@/components/ui/button` 等 shadcn 原件残留、无硬编码 hex。

> 改完自检:`pnpm -C frontend exec tsc --noEmit` + `pnpm -C frontend exec eslint <改的文件>`,0 error 再 rebuild 部署。
