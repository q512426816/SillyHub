# SillyHub 功能体验测试报告

测试日期：2026-05-31  
测试地址：`http://192.168.0.127:3000`  
后端地址：`http://192.168.0.127:8000`  
测试账号：`admin@sillyhub.local`  
测试方式：浏览器黑盒操作 + API 复核 + 前端源码走查

## 结论摘要

平台主链路可以登录、查看工作区、创建 Workspace、创建 Change、创建 Release、创建 Incident、管理用户，并能读取健康状态、运行时、审计等页面。但当前还不是稳定可交付状态，主要风险集中在：

1. Change 文档生成失败，导致变更生命周期被卡住。
2. Workflow 状态流转与后续读取结果不一致，审计显示已流转，但 Change 详情/API 又回到 `draft`。
3. Git Identity 创建因后端缺少 `SILLYSPEC_MASTER_KEY` 直接 503，凭据管理不可用。
4. Release 创建后停在 `draft`，页面没有进入 staging/approved 的操作，部署/回滚链路无法继续。
5. 前端大量页面采用固定侧边栏和宽表格，移动端/窄屏基本不可用。

## 测试覆盖

| 模块 | 覆盖操作 | 结果 |
| --- | --- | --- |
| 首页/健康 | 打开首页，读取 `/api/health` | 通过，显示 backend/db/redis ok |
| 登录 | 默认管理员登录 | 通过 |
| Workspace | 无效路径扫描、有效 `.sillyspec` 扫描、创建一次性 Workspace、删除清理 | 创建通过，扫描结果有展示问题 |
| Change | 创建变更、生成文档、跳过生成、进入详情、提交审查、状态流转 | 创建通过，生成文档失败，状态流转异常 |
| Task | 进入任务看板、重新解析 | 可用，但无任务数据 |
| Release | 创建发布 | 创建通过，但后续部署链路被状态卡住 |
| Incident | 创建事件、调查、缓解、解决、撰写 Postmortem | 通过 |
| Settings/User | 创建用户、设为管理员、禁用、删除清理 | 通过；删除使用原生 confirm 对自动化不友好 |
| Git Identity | 创建 fake PAT | 失败，后端 503 `MASTER_KEY_MISSING` |
| 路由可达性 | 对主要页面做 HTTP 200 检查 | 全部 200 |
| 前端布局 | 源码与页面结构检查 | 存在明显响应式和交互缺口 |

## 测试中产生的数据

已清理：

- 一次性 Workspace：`QA Disposable Workspace`
- 临时本地目录：`/Users/qinyi/.sillyhub-qa-workspace`
- 测试用户：`qa-user-20260531@sillyhub.local`

保留测试数据：

- Change：`2026-05-31-qa-2026-05-31`
- Release：`v0.0.0-qa-20260531`
- Incident：`QA 事件测试 2026-05-31`，状态已解决，已写 Postmortem

## 问题清单

### P0. Change 文档生成失败

复现步骤：

1. 登录后进入 `Workspaces > SillyHub > 变更中心 > 创建变更`。
2. 输入标题 `QA 测试变更 2026-05-31`。
3. 创建成功后选择默认 `Proposal`。
4. 点击 `生成文档`。

实际结果：页面显示 `Request validation failed.`，停留在创建页。  
预期结果：生成所选文档并跳转到 Change 详情页。

影响：新建变更无法补齐 proposal/design/plan 等文档，后续状态流转被守卫规则拦截。

建议：核对 `frontend/src/lib/change-writer.ts` 请求体与后端 `generateDocs` schema，前端应展示具体字段错误，而不是只显示通用失败文案。

### P0. Change 状态流转与持久化不一致

复现步骤：

1. 在 Change 详情页点击 `提议`。
2. 页面显示状态变为 `已提议`。
3. 提交一次审查通过。
4. 再次通过 API/刷新后查看该 Change。

实际结果：审计日志有 `change.transition {"from":"draft","to":"proposed"}`，但 Change API 当前状态为 `draft`。  
预期结果：状态应稳定保持 `proposed`，并且列表、详情、审计一致。

影响：用户无法信任生命周期状态，后续审批/执行链路会出现错乱。

建议：把状态流转后的 DB 读取、文件 frontmatter/MASTER 同步、reparse 覆盖策略梳理成一个明确的事实源。至少避免 reparse 或文件解析把 DB 流转结果静默覆盖。

### P1. 状态流转失败后详情页被整页错误态替换

复现步骤：

1. Change 缺少 proposal 文档。
2. 在详情页点击 `标记已审查`。

实际结果：页面只剩 `Proposal document is missing.` 和返回链接，原详情内容消失。  
预期结果：保留详情页上下文，在顶部显示错误 banner，并提示去创建/生成 proposal。

建议：`ChangeDetailPage` 不要在 `pageError || !change` 时统一返回错误页；有 `change` 时应继续渲染主体内容。

### P1. Git Identity 创建不可用

复现/API 结果：

`POST /api/git/identities` 返回 503：

```text
MASTER_KEY_MISSING: SILLYSPEC_MASTER_KEY environment variable is required.
```

影响：Git 凭据管理、权限检测、Agent worktree 执行链路不可用。

建议：开发环境提供默认测试 master key 或启动前健康检查；前端 Git Identity 页面应在缺少 master key 时给出明确环境配置提示。

### P1. Release 创建后无法继续部署链路

复现步骤：

1. 进入发布管理。
2. 创建 `v0.0.0-qa-20260531`。

实际结果：发布状态为 `草稿`，列表没有 `提交预发布`、`审批` 或类似操作；`部署`按钮只在 `staging/approved` 出现，因此链路中断。  
预期结果：页面提供从 `draft` 到 `staging/approved` 的完整操作。

### P1. Workspace 扫描结果自相矛盾

复现步骤：

1. 添加 Workspace。
2. 扫描一个包含 `.sillyspec` 的目录。

实际结果：顶部 badge 显示 `已检测到 .sillyspec`，但 `.sillyspec` 字段显示 `未找到`。  
原因线索：前端还在读取已废弃的 `scan.sillyspec_path` 字段。

建议：前端不要展示已废弃字段，或后端恢复该字段。

### P2. Components 页面搜索框无实际过滤效果

源码位置：`frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx`

问题：`searchQuery` 和 `viewMode` 状态存在，但没有用于过滤出边/入边，也没有展示视图切换控件。用户输入“搜索关系...”没有可感知结果。

建议：实现关系过滤，或先移除搜索框，避免假功能。

### P2. Agent 控制台存在不可用操作

源码位置：`frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx`

问题：

- `Stop` 按钮没有绑定处理函数。
- Agent Run 的 Task 链接使用 `/changes/-/tasks/{task_id}`，会导航到无效 Change。
- completed runs 的 table map 使用 fragment 但没有稳定 key，容易产生 React warning。

### P2. 原生 confirm 影响可测试性和体验一致性

复现：设置页删除用户、Workspace 删除均使用 `window.confirm`。  
影响：无法统一样式、无法展示更多上下文，自动化测试也容易被阻塞。

建议：改为应用内确认对话框，显示对象名称、影响范围和不可恢复提示。

## 操作流程建议

1. **把 Change 创建做成明确的两段式向导。** 第一步创建元数据，第二步生成/补齐文档。生成失败时应允许重试、查看具体错误、跳过但明确“跳过会阻塞状态流转”。
2. **Change 详情页增加“下一步”引导。** 例如缺 proposal 时，在 `标记已审查` 按钮附近提示“需先生成 proposal.md”。
3. **Release 页面补齐状态动作。** Draft 应有“提交到 Staging”，Staging 应有“申请审批/批准”，Approved 才能部署。
4. **Settings 和 Git Identity 页面增加环境检查。** 缺 `SILLYSPEC_MASTER_KEY` 时不要让用户填完表单才失败。
5. **把破坏性操作统一成 Modal。** 删除用户、删除 Workspace、撤销 Git Identity 都应使用相同确认组件，并支持 loading、错误展示和取消。

## 前端布局建议

1. **移动端当前不可用。** `AppShell` 使用固定 `260px` 侧栏和 `ml-[260px]`，没有移动端抽屉或顶部导航；窄屏会直接挤压主内容。
2. **宽表格缺横向滚动容器。** Changes、Audit、Releases、Users、Incidents 等表格在小屏会溢出。建议统一 `TableContainer`，设置 `overflow-x-auto` 和最小列宽。
3. **页面头部操作区容易拥挤。** Components 页把导航、搜索、重新扫描都塞在右侧，信息密度高但层级不清。建议拆成页面内二级导航 + 工具栏。
4. **按钮文案中英混用。** 如 `Re-scan`、`Bootstrap`、`Sync`、`Import`、`Approval Center`。建议确定产品语言策略，中文界面优先中文动作。
5. **图标使用 emoji 不稳定。** 侧栏 emoji 在不同系统渲染不一致，建议改为 `lucide-react` 图标。
6. **错误提示过于技术化。** 例如 `HTTP_400_WORKSPACE_PATH_NOT_FOUND`、`Request validation failed.`。建议面向用户展示“路径不存在/请求字段不匹配”，技术 code 放在可展开详情中。

## 建议优先级

近期必须修：

- 修复文档生成请求 schema。
- 修复 Change 状态事实源不一致。
- 修复 Git Identity master key 缺失时的启动/页面提示。
- 补齐 Release draft 后续动作。

中期优化：

- 建立统一错误处理组件。
- 建立统一确认 Modal。
- 抽出表格容器和页面工具栏模式。
- 为组件关系搜索、Agent Stop、Agent Run 链接补实现。

回归测试建议：

- E2E：登录、创建 Workspace、创建 Change、生成 proposal、状态流转到 approved。
- E2E：创建 Release，并从 draft 流转到 deployed/rolled_back。
- E2E：创建 Incident，完整流转并创建 Postmortem。
- E2E：用户创建、禁用、启用、删除。
- API：Git Identity 在有/无 `SILLYSPEC_MASTER_KEY` 下的行为。
