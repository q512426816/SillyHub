# 09 — 页面规划

## 页面列表

1. Workspace 首页
2. 项目组组件页
3. 组件详情页
4. 组件扫描认知页
5. 变更中心
6. 变更详情页
7. 任务看板
8. 任务详情页
9. Runtime 页面
10. Git 身份管理页
11. Agent 控制台
12. 审批中心
13. 审计中心
14. 设置页

## 关键页面说明

### Workspace 首页

展示一个 `.sillyspec` 的整体状态。

### 项目组组件页

展示 `projects/*.yaml` 解析结果和组件拓扑。

### 变更详情页

按 SillySpec 变更包结构展示：

```text
MASTER
proposal
requirements
design
prototype
plan
tasks
verification
```

### Git 身份管理页

展示当前用户绑定的 Git Identity，并验证仓库访问权限。

### Agent 控制台

展示 Agent Run、上下文、allowed_paths、工具调用、日志、diff。
