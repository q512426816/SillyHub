# verification — 平台搭建验证方案

## 1. V1 验证目标

验证平台能正确理解和展示 SillySpec Native Layout，并为多人 Git 隔离打好基础。

## 2. 测试样例

使用以下结构作为测试输入：

```text
.sillyspec/
  projects/
    silly.yaml
    silly-admin-ui.yaml
  docs/
    silly/scan/*.md
    silly-admin-ui/scan/*.md
  knowledge/
    INDEX.md
    uncategorized.md
  changes/
    change/2026-05-25-silly-query-enhancement/
    archive/2026-05-21-persistence-spi-jdbc-tck/
  quicklog/
    QUICKLOG-qinyi.md
  .runtime/
    progress.json
    user-inputs.md
    artifacts/
  local.yaml
```

## 3. 必须通过的验证项

### 3.1 Workspace 识别

- 能识别 `.sillyspec`。
- 能读取目录结构。
- 缺失目录时给出友好提示。

### 3.2 projects 解析

- 能将 `projects/*.yaml` 解析为 ProjectComponent。
- 不能错误地展示为普通项目列表。
- 能显示组件关系。
- 能校验组件 path 是否存在。

### 3.3 scan docs 解析

- 能按组件展示 scan 文档。
- 缺失文档显示 warning。
- 能将 scan docs 作为 Agent 上下文候选来源。

### 3.4 Change 解析

- `changes/change/*` 显示为进行中。
- `changes/archive/*` 显示为已归档。
- 能展示 MASTER、proposal、requirements、design、plan、tasks、verification 完整性。

### 3.5 Task 解析

- 能读取 tasks.md。
- 能读取 tasks/task-xx.md。
- 能展示任务看板。
- 无 frontmatter 时能从文件名推断 ID。

### 3.6 Runtime 解析

- 能读取 progress.json。
- 能显示 user-inputs.md。
- 能列出 artifacts。
- 明确 runtime 不作为长期事实源。

### 3.7 Git Identity 验证

- 用户未绑定 Git Identity 时不能执行 Git 操作。
- 用户绑定 Git Identity 后只能访问其有权限的仓库。
- Git 操作使用用户自己的身份。
- 不使用服务器全局 Git 凭据。

### 3.8 Worktree 隔离验证

- 不同用户同一任务使用不同 worktree。
- 同一用户不同任务使用不同 worktree。
- Agent Run 有独立 HOME。
- run 结束后临时凭据被销毁。

### 3.9 Git Tool Gateway 验证

允许：

```text
git status
git diff
git commit
git push task branch
```

禁止：

```text
git push origin main
git push --force
git reset --hard
git config --global
git remote set-url
```

## 4. V1 完成标准

```text
能读、能看、能索引、能隔离 Git 身份和 Worktree。
```

不要求：

```text
自动编码、自动部署、自动合并。
```
