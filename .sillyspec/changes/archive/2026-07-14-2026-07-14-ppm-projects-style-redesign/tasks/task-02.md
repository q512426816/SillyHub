---
id: task-02
title: "`PpmResourceTable` 两处手写浮层换 antd Drawer/Modal"
title_zh: PpmResourceTable 浮层换 antd（maskClosable=false）
author: WhaleFall
created_at: 2026-07-14 11:00:55
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-002@v1, D-006@v1]
allowed_paths:
  - frontend/src/components/ppm-resource-table.tsx
goal: >
  把 PpmResourceDrawer（编辑表单，~L702-893）换 antd Drawer、DeleteConfirm（~L895-924）换 antd Modal，
  均设 maskClosable={false}，消除手写 bg-black/30 遮罩、✕ emoji 关闭按钮、原生 <select>/<input> 控件。
implementation:
  - 引入 antd Drawer/Modal；PpmResourceDrawer 改为 `<Drawer open onClose width={520} maskClosable={false} title=新增/编辑{entityLabel}>`，表单字段、必填/pattern 校验、setValue、submit 逻辑原样搬入 body，底部取消/保存按钮照旧。
  - 表单内原生 <select>/<input>/<textarea> 改用 antd Input/Select/Input.TextArea 或保留受控 inputCls 输入（仅替换容器，不动校验与 disabled/required 语义）。
  - DeleteConfirm 改为 `<Modal open onCancel onOk maskClosable={false} title=确认删除{entityLabel}？>`，正文与取消/确认删除按钮迁入。
  - 删除两处 `fixed inset-0 ... bg-black/30` 遮罩、✕ emoji 关闭按钮、手写面板外壳；保留 canWrite/报错文案/保存中态。
acceptance:
  - ppm-resource-table.tsx 内 grep 不到 `bg-black/30`、emoji `✕`、`fixed inset-0` 手写遮罩
  - 编辑表单为 antd Drawer、删除确认为 antd Modal，视觉正常（遮罩/动画/圆角随 ConfigProvider 主题）
  - 点遮罩不关（maskClosable={false}）；ESC、Drawer 右上角关闭、Modal 取消/✕ 均可关
  - 表单必填/pattern 校验、canWrite 禁用、保存中态、保存成功/失败报错逻辑与改造前一致（功能不回归）
  - 对 3 个复用页（项目/客户/干系人）的编辑/删除流程均生效且无布局错位
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 纯样式，保留表单校验/提交/disabled/报错逻辑不变（D-002）
  - maskClosable={false}（D-006），ESC 与关闭按钮照常可关
  - 不改 PpmFieldDef/PpmFieldOption 接口、不改 onSubmit/row/mode 入参签名
---
