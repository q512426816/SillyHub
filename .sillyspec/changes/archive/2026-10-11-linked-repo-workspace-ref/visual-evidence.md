---
author: qinyi
created_at: 2026-10-11 17:50:00
change: 2026-10-11-linked-repo-workspace-ref
---

# 渲染对照证据（Visual Evidence）— 2026-10-11-linked-repo-workspace-ref

> 本变更是既有卡片内增量（下拉/跳转图标/匹配提示条标准 antd 形态，R-04 声明不另出原型）；以下为代码级对照 + 组件测试断言。

## 对照表

| design 要求 | 实现 | 结论 |
|---|---|---|
| 表单下拉选工作区（排除自身/带搜索） | linked-repos-form.tsx Select showSearch + filter w.id!==currentWorkspaceId | 一致 |
| 已挂载条目跳转 | 名称旁 ↗ 图标，<a href>（jsdom 不依赖 router） | 一致 |
| 回显 matched_workspace 提示 | local_only 条目旁「匹配到 XX ↗」链接 | 一致 |
| both 条目恒 null | 代码 + 测试双断言 | 一致 |
| 未挂载条目回归 | 测试 queryByTitle null 断言 | 一致 |

## 组件测试佐证

15/15 绿（新增 4 例：跳转链接/回归/匹配提示/both 恒 null）。

## 已知偏差

1. 跳转用 `<a href>` 而非 router push——jsdom 下 useRouter 需 app router provider（15 存量用例全崩）；a 标签是 Next.js 支持的导航形态（整页导航），功能等价。
2. R-03 下拉 limit:100 截断——当前平台工作区 <20 实际不触；>100 时需改分页搜索（v2 候选）。
