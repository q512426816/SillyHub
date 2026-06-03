# 02 — 从需求输入到系统部署全生命周期

## 1. 生命周期图

```text
需求输入
  ↓
创建 Change
  ↓
proposal.md
  ↓
requirements.md
  ↓
加载项目组组件上下文
  ↓
design.md / prototype
  ↓
plan.md
  ↓
tasks.md + tasks/task-xx.md
  ↓
Spec Guardian 检查
  ↓
人 / Agent 执行任务
  ↓
Git Identity + Worktree 隔离
  ↓
Tool Gateway 控制工具
  ↓
测试验证
  ↓
verification.md
  ↓
Review / 审批
  ↓
PR / 合并
  ↓
部署
  ↓
归档 archive
  ↓
知识沉淀
```

## 2. 输入阶段

输入来源：

- 平台表单。
- quicklog。
- 外部 Issue。
- SillySpec 工具命令。
- 人工创建变更包。

输出：

```text
.sillyspec/changes/change/{change-id}/
```

## 3. Proposal 阶段

回答：为什么做、解决什么问题、影响哪些组件、不做什么。

输出：

```text
proposal.md
MASTER.md
```

## 4. Requirements 阶段

回答：用户故事、验收标准、边界条件、异常场景。

输出：

```text
requirements.md
```

门禁：requirements 未确认，不允许进入执行。

## 5. Design 阶段

回答：架构、接口、数据、UI、风险、影响范围。

输出：

```text
design.md
prototype-xxx.html
```

## 6. Plan 阶段

回答：如何实施、顺序、依赖、验证方式。

输出：

```text
plan.md
```

## 7. Task 阶段

输出：

```text
tasks.md
tasks/task-xx.md
```

每个任务必须明确：

```text
affected_components
allowed_paths
acceptance
verification
```

## 8. Execute 阶段

执行者：

- 人。
- Claude Code。
- Codex。
- Cursor。
- 自定义 Agent。

约束：

- Git 身份隔离。
- Worktree 隔离。
- Tool Gateway。
- 审计日志。

## 9. Verification 阶段

输出：

```text
verification.md
```

内容：

- 测试命令。
- 测试结果。
- 覆盖的验收标准。
- 失败记录。
- 修复记录。

## 10. Review 和审批

Review 类型：

- Spec Review。
- Code Review。
- Test Review。
- Security Review。
- Release Review。

## 11. Merge 和部署

原则：

- Agent 不能自动合并主分支。
- 生产部署必须人工审批。
- 部署必须可回滚。

## 12. Archive 和知识沉淀

完成后移动：

```text
changes/change/{change-id}
  → changes/archive/{change-id}
```

经验沉淀：

```text
knowledge/
quicklog/
```
