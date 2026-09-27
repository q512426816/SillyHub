---
author: flow-machine-draft
created_at: 2026-09-27T14:08:32.244Z
---
# 需求规格（Requirements）— 2026-09-27-session-fast-replay

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 轮次大纲端点（全轮摘要一次下发 + 会话级缓存）
Given 后端 daemon 模块就绪
When 前端 GET /api/daemon/sessions/{id}/turn-outline
Then 一次响应返回该会话全部轮次摘要（无 500 条截断）：每轮含 run_id、seq 轮号（created_at 升序 1 起）、status/started_at/finished_at/error_code、sender_name、prompt_summary（首条 user_input 日志前 60 字）、answer_summary（首条 reply 文本前 120 字）、engine_anchor/auto_resume_of/tokens 轻列；归属闸门与 runs 端点同款（跨用户/不存在 404）；服务端进程内 LRU 缓存（指纹=runs 计数+max(run.created_at)+max(log.timestamp)+max(log.id)，命中零重算）；空会话返回空 items 不报错

### FR-02: 日志端点按轮直达 + slim 模式 + 单条全文
Given /sessions/{id}/logs 端点就绪
When 传 run_id 参数或 slim=true
Then run_id 命中时只返回该 run 全部日志（升序，上限 2000 条；run 不存在或不属于该会话 404）；slim=true 时 tool 通道 content_redacted 超 2000 字符截断并标记 content_truncated=true（DTO 新增可选字段，旧调用方不传 slim 行为零变化）；新增 GET /sessions/{id}/logs/{log_id} 返回单条全文（slim 展开消费，归属闸门同款）

### FR-03: runs 瘦身 + gzip
Given /sessions/{id}/runs 端点就绪
When 前端拉 runs
Then 响应中 agent_profile_snapshot 剥离 system_prompt 键（保留 name/provider/model 等轻键——前端实证仅消费 name）；响应走 gzip 压缩（对齐 /logs 既有 gzip 路径）；响应其余字段与既有语义零变化

### FR-04: 首屏接线（大纲并行尾页）
Given 前端打开会话
When 首屏装配
Then getTurnOutline 与尾页日志（slim=true）并行请求，首屏 ≤2 次请求即可见最近消息+全量轮次导航；既有触顶翻页保留（before 复合游标 + slim）；初始 autoFill 连发收敛（大纲已提供全量导航后不再为「目录完整」而连发，仅为视口填充保留 ≤2 次）

### FR-05: 未加载轮直达跳转
Given 大纲显示某轮未加载
When 用户点击该轮（导航列或既有入口）
Then 以 run_id 单轮请求直达（≤2 次往返）并 prepend 定位高亮——替代既有 40ms interval 逐页循环（JUMP_LOAD_EARLIER_MAX_PAGES=50 链路退役为 run_id 缺失时的回退）；已加载轮跳转行为不变（直跳+ring 高亮）

### FR-06: 行式轮次导航列（TurnCatalog 重做）
Given desktop 会话面板渲染
When 轮次导航挂载
Then 左侧常驻行式导航列（约 220px，可拖宽收窄）：每行整行命中区（≥40px 高）含轮号+状态点+prompt 摘要+相对时间，当前轮高亮滚动联动保留，未加载轮显示大纲摘要（空心态），>500 轮完整呈现（滚动列内虚拟或分组渲染防卡）；mobile Drawer 导航同源大纲数据；既有 aria-label/键盘可达性保留（整行 role=button+Enter）

### FR-07: slim 工具详情按需全文
Given slim 模式下工具条目被截断
When 用户展开工具详情
Then 截断条目展开时按需拉取单条全文（getAgentSessionLogFull）渲染，非截断条目零额外请求

### FR-08: 行为零回归 + 质量门
Given 本变更 diff 与测试
When 审查与运行
Then SSE 实时流/steering 三态/深链 ?session=/草稿/队列/触顶锚定/content-visibility 等既有行为零回归；旧会话数据（无大纲缓存）首次打开照常回显；既有测试改断言不改意图全绿；pnpm gen:types 同步提交 api-types.ts+openapi.json；tsc/eslint 零新增

