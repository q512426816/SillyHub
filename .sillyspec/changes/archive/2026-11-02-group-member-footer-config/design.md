---
author: flow-machine-draft
created_at: 2026-11-02T05:29:44.707Z
---
# 设计记录（Design Record）— 2026-11-02-group-member-footer-config

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：对齐源是会话底部配置条（frontend/src/components/sessions/session-config-bar.tsx）——它已有供应商→模型级联（候选=供应商 model/default_fallback_model/model_role_mappings 去重保序+首列「默认」）、思考等级七档（THINKING_LEVEL_OPTIONS 前端镜像、引擎 caps 门控）、档案四选。群成员三个配置表面（member-panel.tsx 添加 Agent 表单与切换配置弹窗、create-group-wizard.tsx 第三步成员卡）共用同一套「引擎/模型(实为 llm_provider_id)/方案/机器/工作区」字段——本变更不整体重写三表面，而是抽一个共享的「供应商+模型级联 + 思考等级」子组件（数据源与词表直引 session-config-bar 已导出的 THINKING_LEVEL_OPTIONS / listProviders 同源），三表面接入；「模型（LLM 供应商）」标签更名「供应商」、「智能体方案」更名「档案」；机器下拉 label 改 display_alias/hostname 优先、删引擎名兜底。后端：agent_group_members 增 model/thinking_level 两个可空列（alembic 迁移），成员 create/update schema+服务透传存取，影子创建（group/service/shadow.py）把 model 写入首 run AgentRun.model、thinking_level 经 prepare_interactive_dispatch 透传（session create task-05 FR-03 同参先例）；_build_config_snapshot 的「model」键从供应商名改为真实所选模型名（修正语义错位，multimodal gate 消费口径随之归正）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：
- POST/PATCH 群成员端点请求体：新增可选键 `model: str|None`、`thinking_level: str|None`（None=不指定维持兜底；thinking_level 值域=VALID_THINKING_LEVELS 同源词表，非法 4xx）。
- DB：agent_group_members 新增 `model VARCHAR NULL`、`thinking_level VARCHAR NULL`（alembic 单头迁移）。
- 影子创建首 run：AgentRun.model 由恒 None 改为成员 model（None 保持原兜底）；prepare_interactive_dispatch 新增 thinking_level 实参（None 不传键，placement 真值守护既有）。
- 成员读模型（GroupMemberAddRead 等 Read schema）与 config_snapshot：新增/修正 model（真实模型名）、thinking_level 键。
- 前端：member-panel/create-group-wizard 新增共享子组件（供应商+模型级联、思考等级选择），无既有导出签名变更；成员卡片「模型」行展示模型名+档位。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。成员配置只在创建/热切换时写入行；影子创建读行内值原子生效。热切换已有「模型组 provider/llm_provider_id/agent_profile_id 走热切换、机器组重建」分流（members.py:364），model/thinking_level 归模型组热切换口径（下轮生效），与既有六要素乱序语义同源，不新增竞态面。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：单行 UPDATE 由 PG 行锁串行化，两键与既有六键同一 UPDATE 语句写入，无新增并发面；影子创建读行在事务内一致快照。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。热切换模型组不改影子（下轮注入生效）；机器组重建分支重建影子时读新值建新 run——两分支都从行取值，无半态。存量成员两列 NULL=零回归兜底（派发行为与现状逐字节一致）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。两列挂在成员行（群内唯一），派发参数随成员影子 lease 走，不跨群/跨工作区共享；供应商模型候选按成员配置的 llm_provider_id 解析，不跨供应商串候选。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是 config_snapshot「model」键语义切换的兼容面——现值为供应商名（错位），改存真实模型名后，前端 chips 与 multimodal gate（shadow.py:832）消费口径随之归正，但若有未盘点消费方按「供应商名」解析该键会读错。缓解：盘点 config_snapshot.model 全部消费点（前端 chips、shadow gate）随本变更一并切换；daemon 侧不消费该键（模型走 lease metadata）。次风险：thinking_level 引擎门控口径——pi/codex 的档位支持差异照 session-config-bar 既有 caps 判定复用，不另造词表。放弃的方案：①model/thinking_level 存 config_snapshot JSON 而非独立列——快照定位是展示冗余（组装自关联行），源数据入 JSON 会延续「快照当真值」的错位（本次正是要修它）；②整体替换三表面为 session-config-bar 复用——该组件绑会话 inject 暂存语义（running/ended/暂存态），成员表单是静态配置提交，硬套会引入无关状态面。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/model.py（agent_group_members 模型所在文件，执行期以 grep 定位为准） | 成员模型增 model/thinking_level 两列 |
| 新增 | backend/migrations/versions/<rev>_group_member_model_thinking.py | 单头迁移：两可空列 |
| 修改 | backend/app/modules/daemon/group/service/members.py | create/update schema 字段校验与持久化；快照组装传真实模型 |
| 修改 | backend/app/modules/daemon/group/service/helpers.py | _build/_rebuild_config_snapshot 的 model 键存真实所选模型名 + thinking_level |
| 修改 | backend/app/modules/daemon/group/service/shadow.py | 首_run model=成员模型；prepare_interactive_dispatch 透传 thinking_level |
| 修改 | frontend/src/components/group-chat/member-panel.tsx | 添加表单/切换弹窗接入四选子组件；机器 label 修正；成员卡片模型/档位展示 |
| 修改 | frontend/src/components/group-chat/create-group-wizard.tsx | 向导第三步成员卡同步四选 |
| 新增 | frontend/src/components/group-chat/member-config-fields.tsx | 共享「供应商+模型级联+思考等级+档案」子组件（数据源同 session-config-bar） |
| 新增 | frontend/src/components/group-chat/__tests__/member-panel-config.test.tsx | 前端用例（渲染/级联/payload/机器label） |
| 新增 | backend/app/modules/daemon/tests/test_group_member_model_thinking.py | 后端用例（schema/存取/影子透传/快照） |
