# 01 — SillySpec Native Layout 设计

## 1. 标准结构

```text
.sillyspec/
  projects/
  docs/
  knowledge/
  changes/
    archive/
    change/
  quicklog/
  .runtime/
  local.yaml
```

## 2. 关键语义

### Workspace

一个 `.sillyspec` 根目录就是一个 Workspace。

### projects

`projects/*.yaml` 是项目组成员 / 关联项目组件配置，不是普通项目列表。

### docs

`docs/{component}/scan` 是组件级扫描认知。

### changes

`changes/change` 是进行中变更。

`changes/archive` 是已归档变更。

一个变更可以影响多个组件。

### knowledge

Workspace 级知识库。

### quicklog

用户级快速日志。

### .runtime

当前本地执行态，不应提交 Git。

### local.yaml

本地运行配置，建议不提交；如需模板，使用 `local.example.yaml`。

## 3. 平台适配原则

平台不能要求用户迁移到新的目录结构。

平台应该：

```text
读取原始文件
保留原始路径
建立内部索引
提供可视化和执行管理
```
