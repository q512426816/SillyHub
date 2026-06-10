---
author: WhaleFall
created_at: 2026-06-08T11:00:00
---

# Requirements: 变更中心列展示优化

## 角色

| 角色 | 说明 |
|---|---|
| 开发者 | 通过变更中心列表查看变更状态，需要快速识别待办和变更类型 |

## 功能需求

### FR-01: 类型列自动推断

Given 变更目录包含 `tasks/` 子目录和 `plan.md`/`design.md`
When Parser 扫描该目录
Then `change_type` 被推断为 `"feature"`

Given 变更目录名包含 "quick" 或仅包含 MASTER.md + request.md
When Parser 扫描该目录
Then `change_type` 被推断为 `"quick"`

Given 变更目录包含 `prototype-*.html` 文件
When Parser 扫描该目录
Then `change_type` 被推断为 `"prototype"`

Given 变更目录不匹配任何特定规则
When Parser 扫描该目录
Then `change_type` 默认为 `"feature"`

### FR-02: 影响组件自动推断

Given 变更目录下有 `module-impact.md`
When Parser 扫描该目录
Then `affected_components` 从 module-impact.md 提取模块名

Given 变更目录下无 `module-impact.md` 但有 `tasks.md` 或 `tasks/*.md`
When Parser 扫描该目录
Then `affected_components` 从文件路径中提取模块名（通过 module-map paths 匹配）

Given 变更目录下无 tasks 相关文件
When Parser 扫描该目录
Then `affected_components` 为空列表

### FR-03: reparse 覆盖策略

Given DB 中 `change_type` 为 null
When reparse 执行时 Parser 推断出 change_type
Then DB 中的 change_type 被更新为推断值

Given DB 中 `change_type` 已有非 null 值
When reparse 执行时
Then DB 中的 change_type 不被覆盖

Given reparse 执行时
When Parser 推断出 affected_components
Then DB 中的 affected_components 总是被更新（因为推断值更准确）

### FR-04: 状态列展示 human_gate

Given 变更的 `human_gate` 不为空且不为 `"none"`
When 前端渲染状态列
Then 显示对应中文待办 Badge（如"待提案审核"、"待人工测试"）

Given 变更的 `human_gate` 为空或 `"none"`
When 前端渲染状态列
Then 根据 `current_stage` 显示阶段状态

### FR-05: 阶段列 null 兜底

Given 变更的 `current_stage` 为 null 或 undefined
When 前端渲染阶段列
Then 显示 "draft" badge

### FR-06: 类型列颜色映射

Given 变更的 `change_type` 为 `"feature"`
When 前端渲染类型列
Then 显示蓝色 Badge

Given 变更的 `change_type` 为 `"quick"`
When 前端渲染类型列
Then 显示黄色 Badge

Given 变更的 `change_type` 为 `"prototype"`
When 前端渲染类型列
Then 显示紫色 Badge

## 非功能需求

- **兼容性**：旧数据（无 tasks.md、change_type 为 null）仍正常展示，不报错
- **可回退**：Parser 推断失败时返回安全默认值（"feature" / []），不影响已有数据
- **性能**：Parser 读取 tasks.md 是文件 I/O，reparse 场景下可接受；非 reparse 请求无额外开销
