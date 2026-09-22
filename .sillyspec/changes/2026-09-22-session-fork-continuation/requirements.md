---
author: qinyi
created_at: 2026-09-22 11:25:23
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 会话用户 | 在任意普通会话中发起分叉、在分叉会话中继续对话、回看原会话 |
| 平台开发者 | 维护 fork 端点/caps 能力位/锚点回填链/谱系 UI |

## 功能需求

### FR-01: 通用轮级分叉入口
覆盖决策：D-001@v1, D-003@v1
Given 任意普通会话（不限 sillyspec 变更上下文）存在已终态轮
When 用户在该轮轮头动作区点「从此分叉」并确认
Then 弹层确认后创建分叉会话并进入

#### 场景：进行中轮不可选
Given 目标轮 run 状态为 running
When 用户查看该轮动作区
Then 入口置灰/不可点（文案「进行中不可分叉」）

#### 场景：caps=none 引擎无入口
Given 会话 provider 的 sessionFork 能力位为 none（如 cursor）
When 用户查看任意轮动作区，或直接调 POST /sessions/{id}/fork
Then 前端不渲染入口；API 返回 422

### FR-02: 分叉会话创建与继承（源会话零影响）
覆盖决策：D-005@v1
Given 用户在会话 A 第 N 轮（已终态）发起分叉
When fork 端点执行成功
Then 新会话 B 落库：origin='fork'、fork_of_session_id=A、fork_at_run_id=该轮、engine_fork_anchor=该轮引擎锚（native 档）；workspace/供应商/模型/档案按 A 当前值快照继承

#### 场景：A 零字段改动
When 分叉完成后比对 A 的全部数据库字段
Then 与分叉前完全一致；A 可继续正常对话

#### 场景：分叉点非法
Given at_run_id 不属于该会话（404）、或该轮进行中（409）、或 native 档锚点缺失（422 附「可退种子档」提示）
When 调 fork 端点
Then 对应错误码返回，B 不落库（事务回滚）

### FR-03: claude 原生真截断分叉
覆盖决策：D-004@v1, D-007@v1
Given claude 会话第 N 轮已终态且 engine_anchor 存在
When fork 走 native 档（lease.metadata 携 resume_session_id+resume_at_uuid+fork_session，经既有 create-with-resume 管道）
Then B 的 SDK 上下文=截至第 N 轮（含）的原生历史；B 对第 N+1 轮及之后内容完全不知情；fork 后新 SDK session id 按既有回写链覆盖 agent_session_id

### FR-04: 种子档降级（codex；pi 视 spike 定档）
覆盖决策：D-004@v1, D-007@v1
Given provider 的 sessionFork=seed（codex；pi 若 spike 失败）
When fork 执行
Then B 以「前情转述」种子消息启动：截至第 N 轮的用户轮全文+助手轮摘要、超 FORK_SEED_MAX_CHARS 帽截尾并声明；UI 标注「种子分叉·前情转述（非原生上下文）」

#### 场景：pi spike 定档
Given Wave1 pi spike 实测 fork/switch_session 截断语义
When spike 断言「能截断到指定消息」
Then pi 升 native 档（caps 值+driver fork 启动路径）；否则落 seed 档，结论落 D-008

### FR-05: 谱系溯源 UI
覆盖决策：D-002@v1
Given 会话 B 为分叉会话（origin='fork'）
When 用户打开 B
Then B 顶部常驻溯源块（分叉自哪个会话@第几轮+引擎档标注+时间）；点击以浮层打开原会话完整记录（复用 WorkerSessionOverlay 形态+「已分叉」状态条）

#### 场景：多跳链
Given B 又被分叉出 C
When 用户打开 C
Then 谱系面包屑呈 A → B → C（当前），每个历史节点可点开浮层

#### 场景：会话列表
When 分叉产生后查看会话列表
Then B 挂 A 附属分组下、带「分叉」徽标；与分身子会话分组区分（origin 判定）

### FR-06: 能力位 sessionFork 三端单源
Given ProviderCaps 现有 15 键（14 布尔 + dialog 枚举值键先例，providers.ts:327）
When 增第 16 键 sessionFork（枚举 native/seed/none，生成器沿用 dialog 枚举先例扩展）
Then sillyhub-daemon providers.ts 单源 + gen-provider-caps.mjs 三端生成 backend provider_caps.py / frontend provider-caps.ts，alignment 守护测试升 16 键；claude=native、codex=seed、cursor=none、pi=spike 后定；三端取值处对缺键按 none 默认拒绝兜底

### FR-07: 轮锚点落库
Given claude/pi 会话每轮消息上行（run_sync）
When 轮终态提交（claude）/轮首条用户消息落库（pi）
Then AgentRun.engine_anchor 回填——claude=该轮末 chain-entry 消息 UUID；pi=该轮首条用户消息 entryId（D-008/010 分档语义）；codex 恒 NULL

#### 场景：pi 档 fork 锚取法
Given 用户在 pi 会话第 N 轮后发起分叉
When fork 服务取锚
Then N 非末轮→取第 N+1 轮 engine_anchor（其用户 entryId）position before；N 为末轮→clone 全量分叉（等价「末轮后分叉」语义）

#### 场景：存量轮无锚点
Given 迁移前已存在的轮（engine_anchor NULL）
When 用户尝试原生分叉该轮
Then 入口置灰（提示缺锚点）；种子档不受影响

## 非功能需求
- 兼容性：新列全可空、新端点独立、create_session 新参数缺省走原路径；旧前端收 16 键 caps 忽略未知键（缺键视为 none）；既有 resume/reopen/inject 语义零改动
- 可回退：fork 校验失败 B 不落库（事务内）；pi spike 失败仅 caps 落 seed 无废弃件
- 可测试：档位门控/终态轮校验/种子体积帽/A 零影响各有 pytest；daemon 参数透传与 caps 契约有单测；前端入口门控与溯源块有组件测试
- 无长驻进程/外部资源新增（复用既有 spawn/lease 链）

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 通用为纲：入口不依赖 sillyspec 上下文；handoff 特例后置 |
| D-002@v1 | FR-05 | 子代理式溯源：溯源块+浮层+链式面包屑 |
| D-003@v1 | FR-01, FR-07 | 轮级粒度：AgentRun 边界；引擎锚由轮末消息派生 |
| D-004@v1 | FR-03, FR-04, FR-06 | 引擎两档：claude native / codex·pi seed；UI 标注语义差异 |
| D-005@v1 | FR-02 | 原会话保留可继续：A 零字段改动 |
| D-006@v1 | —（非目标约束） | handoff 自动续接不并入本期（proposal 不在范围清单） |
| D-007@v1 | FR-03, FR-04 | 方案C：backend 主导管道扩展 + pi 原生 spike 定档门 |
