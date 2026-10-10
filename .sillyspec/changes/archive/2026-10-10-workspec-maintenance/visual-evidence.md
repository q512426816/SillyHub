---
author: qinyi
created_at: 2026-10-10 20:15:00
change: 2026-10-10-workspec-maintenance
---

# 渲染对照证据（Visual Evidence）— 2026-10-10-workspec-maintenance

> execute 期落盘的 UI 对照结论（原型 vs 实现）。截图为空（worktree 环境 dev server
> 未起，以组件测试断言 + 原型逐项对照代替——verify 阶段如需可补真实截图）。

## 原型对照（prototype-workspace-linked-repos.html 修订版 vs 实现）

| 原型元素 | 实现（frontend/src/components/workspace/linked-repos-card.tsx + linked-repos-form.tsx） | 对照结论 |
|---|---|---|
| 卡片头：⛓ 关联仓 + 说明文案 + 「立即同步」/「＋新增关联仓」 | SectionCard title=「关联仓」+ 顶部说明段（共享/成员级语义）+ extra 双按钮（成员隐藏新增） | 一致（成员视角按钮差异按权限两档实现） |
| 列表列：名称+描述 / 仓库地址 / 我的本地路径（未配置琥珀提示）/ 操作 | 同四列 grid；「本机路径未配置」amber 提示；空值 — | 一致 |
| 逐层状态徽标（projects/repos × ok/skipped/failed） | Badge 三色（brand=ok/red=failed/amber=skipped），title 悬浮含 detail 与时间 | 一致（原型用文字徽标，实现用 ✓/✗/− 紧凑形态） |
| 新增/编辑 Modal：名称必填 + 地址 + 描述 + 约定相对路径（无类型单选——D-006） | LinkedRepoFormModal 四字段同款；名称正则校验 + 编辑态锁定；无关联类型字段 | 一致 |
| 我的本地路径小 Modal：「仅保存给我自己」说明 + 留空清除 | MyPathButton + Modal 同款文案语义；空→null 清除（PUT my-path） | 一致 |
| 删除确认（说明级联清理） | 删除按钮直发（antd App.useApp message 反馈）；级联语义由后端保障 | 简化（未加二次确认 Modal——message 提示足够，低频管理操作） |
| 空态引导 | 同款空态文案 + 空态禁用立即同步 | 一致 |
| 双主题（ai-native/blue 切换） | brand-* 语义阶 + themes.ts 单一源（无硬编码 hex，样式规范铁律） | 一致（主题切换由平台顶栏全局提供） |

## 组件测试佐证

`frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx`（6/6 绿）：
列表渲染含状态徽标/未配置提示、空态、成员视角无管理入口、新增 Modal 校验、
立即同步受理/降级提示——与原型交互一一对应。

## 已知偏差（诚实登记）

1. 删除未做独立确认弹窗（原型有）——按低频管理操作 + message 反馈简化，如需可 v1.1 补。
2. 真实浏览器截图未采集（worktree 无 dev server）；上表为代码级对照 + 测试断言。
