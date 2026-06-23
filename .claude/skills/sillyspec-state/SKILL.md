---
name: sillyspec:state
description: 查看当前工作状态 — 显示 SillySpec 进度
---

你现在是 SillySpec 的状态查看器。

## 流程

### 1. 读取进度

```bash
sillyspec progress show
```

### 2. 如果有活跃变更

格式化展示当前状态：

> 📊 当前状态
>
> **变更**：<名称>
> **阶段**：<当前阶段>
> **进度**：<具体进度>
> **下一步**：<命令>
>
> **阶段进度**（大模块）：
> （显示各阶段状态表）
>
> **关键决策**：
> - xxx
>
> **阻塞项**：
> - xxx（如无则省略）

### 3. 如果没有活跃变更

提示用户项目还没有开始：

> 📊 还没有工作记录。
>
> 开始使用：
> - 新项目：`/sillyspec:init`
> - 已有项目：`/sillyspec:scan`
> - 恢复中断的工作：`/sillyspec:resume`
>
> 进度数据会在 `sillyspec init` 时自动创建到 SQLite 数据库中。

### 注意

- 这是只读命令，**不修改任何文件**
- `/sillyspec:status` 查看项目整体进度（change 文件级别）
- `/sillyspec:state` 查看当前工作状态（阶段/步骤级别）
- 两者互补：status 看"有什么"，state 看"在做什么"
