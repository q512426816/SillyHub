---
author: qinyi
created_at: 2026-08-28 02:47:57
---

# 决策记录（Decisions）

## D-001@v1: 关联入口双向都要
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 会话与 PPM 任务/问题的关联入口要哪些？
- answer: 双向都要——任务/问题侧提供"发起会话"入口（详情/列表处），会话输入框 @联想扩展支持选择 PPM 任务/问题，与现有变更/快速修复绑定体验一致。
- normalized_requirement: 任务侧入口与 @联想入口均须实现；@联想数据源在现有 change/quicklog 分组外新增 PPM 任务/问题分组。
- impacts: [FR-01, FR-02, FR-05]
- evidence: 用户 2026-08-28 AskUserQuestion 回答「双向都要（推荐）」

## D-002@v1: 全状态可关联
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 哪些状态的任务/问题允许关联会话？
- answer: 全状态可关联。列表/联想默认展示"进行中"，但已完成/未开始的任务也能手动关联（如复盘场景）。
- normalized_requirement: 绑定链路不做状态过滤硬限制；@联想与任务侧"发起会话"入口默认展示"进行中"项，允许切换查看全部。
- impacts: [FR-01, FR-02]
- evidence: 用户 2026-08-28 AskUserQuestion 回答「全状态可关联（推荐）」

## D-003@v1: 附件真注入 + 降级文字清单
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: PPM 任务的附件（file_urls）以什么形式进会话？
- answer: 真附件注入——后端尝试读取附件内容作为真附件传给 agent（能看图/读文件）；读取失败的降级为文字清单（附件名+链接）。
- normalized_requirement: 创建会话携带 PPM 任务上下文时，后端读取任务 file_urls 对应内容，可读则按附件注入（多模态块或落盘），不可读则在前导文字中列附件名+URL。
- impacts: [FR-03]
- evidence: 用户 2026-08-28 AskUserQuestion 回答「真附件注入（推荐）」；附件机制参照 backend/app/modules/session_attachment/

## D-007@v1: PPM 附件访问控制复用 _can_access
- type: compatibility
- priority: P1
- status: accepted
- source: design-grill
- question: PPM 附件物化/降级链接的访问控制口径（file 模块 owner-only：_can_access 仅放行上传者/平台管理员，owner_type=ppm_* 不在锚列表）？
- answer: 复用 FileService._can_access 同口径校验：有权条目物化注入；无权条目降级文字清单仅列文件名并注明「无权访问」（不带链接）。行为对齐 PPM UI 现状（batch_meta 同样静默剔除无权行），不引入跨用户文件读取。
- normalized_requirement: materialize 前对 File 行逐条做 _can_access 等价校验（上传者本人/平台管理员）；无权条目不读 bytes、不物化、文字清单无链接。
- impacts: [FR-03]
- evidence: design-grill X-02；backend/app/modules/file/service.py:137-179 _can_access、:232-241 batch_meta 静默剔除

## D-006@v1: PPM 附件物化为 SessionAttachment
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: PPM file_urls 附件如何进入 SESSION_INJECT 通道（daemon disk/回拉模式按 id 回调 session-attachments/{id}/content 下载，PPM file_id 不在该表）？
- answer: 创建会话携带 ppm item 时，后端把任务 file_urls 对应 File 读取 bytes → 写入 session attachment storage → 物化 SessionAttachment 行（session_id 直接回填、user_id=创建者），并入现有 attachment_ids 组装链路（assemble_inject_attachments/download 回调/标记行/前端展示全复用，daemon 零改动）。
- normalized_requirement: 物化行与用户手动附件合并计数校验（图≤5 文≤5），超出的 PPM 附件降级前导文字清单；provider≠claude 时 PPM 附件不物化、全部走文字清单降级，不阻塞创建；物化失败（file 已删/存储读失败）同样降级文字清单，不阻塞。
- impacts: [FR-03]
- evidence: daemon.ts:3241-3251 downloadAttachment 闭包 + hub-client downloadSessionAttachment 按 id 下载；session_attachment/service.py assemble_inject_attachments:148

## D-005@v1: 统一 PPM 绑定表（方案 B）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 会话绑定 PPM 任务/问题的数据模型方案选哪个（A 每类一表克隆 / B 单表 kind 区分 / C 泛化重织基座）？
- answer: 方案 B——一张 `ppm_item_session_links` 表（kind 字段区分 plan_task/problem），一套绑定 helper + 一个统一前导构建器；@联想/会话筛选/任务侧卡片前端逻辑复用一套。
- normalized_requirement: 单表 M:N（workspace_id + kind + item_id + session_id，唯一约束防重）；不重构现有 change_session_links/quicklog_session_links；kind 枚举 plan_task|problem，预留后续扩展。
- impacts: [FR-01, FR-02, FR-05]
- evidence: 用户 2026-08-28 AskUserQuestion 回答「方案 B（推荐）」；参照 backend/app/modules/change/model.py:247/:291 既有双表模式，本决策取单表 kind 同构路线

## D-004@v1: 多工作区自动选第一个（已被 v2 细化排序键）
- type: boundary
- priority: P1
- status: superseded
- source: user
- question: 任务所属项目关联了多个工作区时，发起会话怎么选工作区？
- answer: 自动选中第一个关联工作区（可在会话面板里手动切换），路径最短。
- normalized_requirement: 从任务/问题发起会话时，按项目→ppm_project_workspace 解析工作区，默认取第一个（稳定排序），预会话面板允许手动切换工作区；项目未关联任何工作区时按无工作区会话处理（不阻塞）。
- impacts: [FR-01, FR-04]
- evidence: 用户 2026-08-28 AskUserQuestion 回答「自动选第一个（推荐）」；关联表 backend/app/modules/workspace/model.py:181 ppm_project_workspace

## D-004@v2: 工作区排序键定死 workspace_id 升序
- type: definition
- priority: P2
- status: accepted
- supersedes: D-004@v1
- source: design-grill
- question: 「第一个关联工作区」的稳定排序键是什么（ppm_project_workspace 表无时间列、list_by_project 查询无 ORDER BY，返回序不稳定）？
- answer: workspace_id 升序（UUID 字典序）为唯一排序键，后端 link.workspace_id 写入与前端预选同键，消除分叉。
- normalized_requirement: 解析第一个关联工作区一律 ORDER BY workspace_id ASC LIMIT 1；前端 listProjectWorkspaces 结果同键排序后取首个。
- impacts: [FR-01, FR-04]
- evidence: design-grill X-03；backend/app/modules/workspace/model.py:181-212（复合主键无顺序列）、link_service.py list_by_project 无 ORDER BY
