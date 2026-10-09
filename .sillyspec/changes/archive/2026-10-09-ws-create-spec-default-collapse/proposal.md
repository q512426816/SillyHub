---
author: flow-machine-draft
created_at: 2026-10-09T14:58:49.787Z
---
# 提案书（Proposal）— 2026-10-09-ws-create-spec-default-collapse

## 动机

任务原话转写：新建工作区表单的 spec 同步策略选项过多且默认值不合用户习惯，希望默认走源项目即真理并收起低频选项，降低创建表单噪音。

成功标准:
- 桌面端与移动端创建工作区表单的 spec 策略默认值均为 repo-native（源项目即真理）
- spec 策略单选列表默认收起，仅显示摘要行与更多选项入口；点击展开后才显示完整三选项可切换
- 未展开时 platform-managed 与 repo-mirrored 两个选项不出现在 DOM
- 选项文案中平台托管（默认…）的默认字样随新默认值移除
- 选中 repo-native 时 ⚠ 写入源项目提示可见（含默认收起态）
- 提交体 spec_strategy 传当前选中值（默认 repo-native），既有创建链路无回归

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. 桌面端与移动端创建工作区表单的 spec 策略默认值均为 repo-native（源项目即真理）
2. spec 策略单选列表默认收起，仅显示摘要行与更多选项入口；点击展开后才显示完整三选项可切换
3. 未展开时 platform-managed 与 repo-mirrored 两个选项不出现在 DOM
4. 选项文案中平台托管（默认…）的默认字样随新默认值移除
5. 选中 repo-native 时 ⚠ 写入源项目提示可见（含默认收起态）
6. 提交体 spec_strategy 传当前选中值（默认 repo-native），既有创建链路无回归

## 成功标准（可验证）

1. 桌面端与移动端创建工作区表单的 spec 策略默认值均为 repo-native（源项目即真理）
2. spec 策略单选列表默认收起，仅显示摘要行与更多选项入口；点击展开后才显示完整三选项可切换
3. 未展开时 platform-managed 与 repo-mirrored 两个选项不出现在 DOM
4. 选项文案中平台托管（默认…）的默认字样随新默认值移除
5. 选中 repo-native 时 ⚠ 写入源项目提示可见（含默认收起态）
6. 提交体 spec_strategy 传当前选中值（默认 repo-native），既有创建链路无回归
