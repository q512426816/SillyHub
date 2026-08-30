---
author: qinyi
created_at: 2026-08-26 19:32:00
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 工作区成员（Writer） | 可在 skills 页管理本工作区自定义 skill |
| agent | skill 的最终消费者（经 daemon spec sync 拉取 worktree） |

## 功能需求

### FR-01: skill 级 CRUD
覆盖决策：D-001@v1

Given 用户是工作区 Writer 且打开 skills 页
When 提交新建 skill（合法名 + 可选描述）
Then 生成 `skills/<名>/SKILL.md`（frontmatter 含 name/description），列表刷新显示

Given skill 名非法（非白名单字符/含 `..`/已存在）
When 提交新建
Then 422/409 中文报错，不落盘

Given 用户删除 skill 并二次确认
When 确认删除
Then skill 目录整体删除（含符号链接防护），审计落行

### FR-02: 文件级 CRUD（双栏交互）
覆盖决策：D-001@v1, D-002@v1

Given 用户选中某 skill 的某文本文件
When 右栏编辑器修改并保存
Then PUT 原子写入 specDir，成功提示「下次同步对新会话生效」

Given 用户新建文件（合法两层内路径）/删除文件（非 SKILL.md）
When 确认操作
Then 文件树刷新反映变化；SKILL.md 删除被 409 拒绝且前端按钮禁用

### FR-03: 安全约束
覆盖决策：D-003@v1

Given 任意路径穿越尝试（`../`、绝对路径、盘符、编码变体）
When 调文件端点
Then 422 中文「文件路径不合法」，磁盘零接触

Given 二进制文件（UTF-8 解码失败）或 >512KB
When 读/写
Then 415/413 中文报错

### FR-04: 数据通道与生效
覆盖决策：D-004@v1, D-005@v1

Given 文件成功写入 specDir/skills/
When daemon 下次 spec sync
When 经 manifest 增量同步到 worktree `.claude/skills/workspace/`（既有链路，本变更零 daemon 改动）
Then 新会话可用更新后的 skill

### FR-05: 审计
覆盖决策：D-006@v1

Given 任一写操作（建/删 skill、写/删文件）成功
When 提交完成
Then audit_logs 落行（action=workspace_skill.*，details 含 skill 名/文件路径，不含文件内容）

## 非功能需求

- 兼容性：GET skills 列表响应结构不变；无 skills/ 目录空态不变（brownfield 零回归）
- 跨平台：路径处理 Windows/Linux 通用（resolve/commonpath）
- 可回退：页面无破坏性操作无确认拦截（删除有二次确认）
- 可测试：路径安全变体/权限/约束全分支用例；错误中文（守护测试口径）

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02 | 完整文件编辑范围 |
| D-002@v1 | FR-02 | 页内双栏交互 |
| D-003@v1 | FR-03 | 安全约束集 |
| D-004@v1 | FR-04 | specDir 直读直写 |
| D-005@v1 | FR-04 | daemon 零改动 |
| D-006@v1 | FR-05 | 手工审计 |
