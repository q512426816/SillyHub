---
author: qinyi
created_at: 2026-08-28 03:12:45
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 用户（PPM 成员） | 在 PPM 登记任务/填报问题的成员，通过任务侧入口或 @联想发起/绑定会话 |
| 会话使用者在会话中讨论 PPM 任务，消费注入的任务上下文与附件 |
| Agent（会话引擎） | 消费 dispatch_prompt 中的 PPM 前导与 SESSION_INJECT 附件 |
| 平台管理员 | file 中心 _can_access 放行口径之一 |

## 功能需求

### FR-01: 会话绑定 PPM 任务/问题（创建通道）
覆盖决策：D-005@v1, D-004@v2

Given 存在 PlanTask/PpmProblemList 记录（任意状态）
When 创建会话请求携带 `ppm_item_kind`（plan_task|problem）+ `ppm_item_id`
Then 写入 `ppm_item_session_links`（幂等 upsert，唯一约束 kind+item_id+session_id），link.workspace_id 与会话 workspace_id 按项目关联工作区 workspace_id 升序取第一个（未显式指定 workspace 时），无关联工作区留空不阻塞

Given `ppm_item_id` 不存在或已删
When 创建会话
Then 不报错，跳过绑定与前导（降级为普通会话），记 warning 日志

### FR-02: @联想与追问绑定（双向入口）
覆盖决策：D-001@v1, D-002@v1

Given 会话输入框（有 workspace 的会话，atEnabled 门控沿用）
When 输入 @ 唤起联想
Then 出现「PPM 任务」「PPM 问题」分组：任务=listPersonalPlanTasks(status=["进行中"])，问题=问题列表 duty_user_id=me(status=进行中)，均提供切全部开关；条目标注项目名

Given 预会话选中 PPM 条目后发送首句
When createSession 提交
Then 携带 ppm 绑定字段创建（FR-01 链路）

Given 真会话中选中 PPM 条目后追问
When injectSession 提交
Then 携带 bind_ppm_item_kind/bind_ppm_item_id 只追加 link，不注入前导

### FR-03: 上下文注入（文字全字段 + 附件）
覆盖决策：D-003@v1, D-006@v1, D-007@v1

Given 会话绑定 PPM item 成功
When create_session 组装 dispatch_prompt
Then 注入【PPM 任务上下文】/【问题上下文】前导（标题/描述/状态/项目/模块/责任人/周期全字段），执行序为物化在前、前导消费 attachment_lines；storage 读 IO 与降级决策在写事务外，SessionAttachment 行 insert 在写事务内 flush-only

Given item.file_urls 非空且 provider=claude 且与手动附件合并后 图≤5/文≤5 且逐条通过 _can_access（上传者/平台管理员）
When 物化
Then 读 file storage bytes → 写 session attachment storage → 物化 SessionAttachment 行（session_id 回填、user_id=创建者）→ 并入现有组装链路（标记行/多模态块/落盘，daemon 零改动）

Given 超限、provider≠claude、File 已删/读取失败、无权访问任一情况
When 物化
Then 该条目降级前导文字清单：有权条目列文件名 + `GET /api/file/{file_id}` 链接；无权条目仅列文件名注明「无权访问」；均不阻塞会话创建

### FR-04: 任务/问题侧入口 + 关联会话卡片
覆盖决策：D-001@v1, D-004@v2

Given task-plans 个人视图 / workbench 我的任务表 / problem-list 详情抽屉
When 点击行/详情处「发起会话」
Then store 写入 pendingPpmItem 挂起位并 requestNewSession，宿主构造 preContext.ppmItem，前端解析项目第一个关联工作区（workspace_id 升序）填 workspaceId（解析不到不带）

Given 任务/问题详情渲染
When 存在关联会话
Then 「关联会话」卡片展示本人前 3 条预览（进行中/已结束状态、标题、相对时间），点击深链 `?session=` 打开会话面板查看完整会话信息，并提供「+ 新会话」按钮

### FR-05: 会话列表关联筛选（ppm 维度）
When 会话列表「关联」筛选选择 PPM 任务/问题选项（value 编码 `ppm:<kind>:<uuid>`）
Then listAgentSessions 透传 ppm_item_kind/ppm_item_id，后端 M:N 子查询过滤

### FR-06: 「发起团队」预选修复
Given PPM 项目页点击「发起团队」
When 预会话面板打开
Then 派团队弹层自动打开；项目自动选中（defaultProjectId）+ scopeMode=按项目；自动拉取项目关联工作区按 workspace_id 升序预选第一个；objective 预填「分析项目 X…」句式（可改）

## 非功能需求

- 兼容性：新字段全部 Optional 缺省零回归；旧会话查询零命中；PPM 既有 API 行为不变
- 可回退：删表 + 代码回滚即回退，无数据迁移副作用
- 可测试：绑定/前导/物化/降级路径均有可构造的 Given-When-Then；工作区排序键前后端同键可断言

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02, FR-04 | 双向入口（任务侧 + @联想） |
| D-002@v1 | FR-02 | 全状态可关联，默认展示进行中可切全部 |
| D-003@v1 | FR-03 | 附件真注入优先，失败降级文字清单 |
| D-004@v2 | FR-01, FR-04, FR-06 | 多工作区自动选第一个，排序键 workspace_id 升序（supersedes v1） |
| D-005@v1 | FR-01 | 单表 kind 绑定（方案 B） |
| D-006@v1 | FR-03 | 附件物化 SessionAttachment（daemon 零改动） |
| D-007@v1 | FR-03 | 附件访问控制复用 _can_access，无权仅列文件名 |
