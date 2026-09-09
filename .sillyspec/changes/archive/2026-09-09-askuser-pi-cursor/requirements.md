---
author: qinyi
created_at: 2026-09-09 22:50:18
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 会话用户 | 单聊会话中回答 agent 提问的人（会话属主） |
| 群成员 | 群聊会话的任意成员（含非群主），可看到并回答成员 agent 的提问 |
| agent 引擎 | pi / cursor / claude / codex（提问发起方，经各自端头协议） |
| 平台开发者 | 后续接入新引擎时按 caps dialog 声明复用协议 |

## 功能需求

### FR-01: pi 轮中阻塞提问
覆盖决策：D-002@v1, D-007@v1
Given pi 会话运行中且 Wave A 已启用（caps dialog=native、permission_dialog=true）
When pi extension 层发起 dialog 类 ui_request（select/confirm/input/editor）
Then daemon 归一化为 dialog_payload.questions[]（confirm 合成「是/否」选项、input/editor 合成占位选项）并以 dialog_kind=pi_extension_ui 上报，pi 进程挂起等待
When 用户在提问卡提交回答
Then 答案 denormalize 回 pi RPC reply，pi 同轮继续执行

### FR-02: pi 桥接安全与生命周期语义
覆盖决策：D-002@v1
Given pi dialog 挂起等待中
When 用户长期不作答
Then 永久等待（对齐平台 dialog 不超时语义），无 5min/30min 强制超时
When 会话 end/fail 或驱动 close/abort
Then 挂起表统一回 cancelled:true，pi 进程收到取消正常收尾
When pi 发起权限类 extension 请求或未知方法
Then 维持现状自动拒绝/取消（零桥接红线），日志留痕

### FR-03: cursor 纯前端标记提问
覆盖决策：D-003@v2, D-006@v2
Given cursor 会话且 spike 达标（caps dialog=marker）
When agent 回复文本尾部携带合法 ```askuser JSON 标记
Then 标记随文本原样持久化（不剥离、无后端 dialog 行）；前端在单聊时间线渲染提问卡并隐藏标记原文（流式与历史同一解析器）
When 用户在标记卡提交选择/输入
Then 答案组装为下一条用户消息走既有发送链路，cursor 经 --resume chatId 续轮
Given 标记非法（JSON 坏/必填缺失/超 4KB/非尾部）
Then 当普通文本显示，功能不坏（warn 日志）

### FR-04: cursor spike 门槛与降级
覆盖决策：D-003@v2
Given Wave B 编码前
When 真机 10 次澄清场景测试
Then 合法标记 ≥8/10 判达标启用 prompt 注入与 marker 卡；<8/10 则不注入 prompt、caps=none，解析器与卡片代码保留（协议资产）

### FR-05: 群聊聚合与任何成员先到先得
覆盖决策：D-004@v2, D-006@v2
Given 群聊会话且有成员（影子会话 session_kind='group_member'）存在 pending 原生提问
Then 群聊流内渲染提问卡（成员 agent 来源标注 + recommendResponders 推荐 @条）
When 任意群成员（非群主）提交回答
Then 放行（授权门双条件：群聊影子会话 + 答题者为该群成员），answered_by 记实际答题人
When 另一成员随后再提交
Then 收已答 409 → 渲染「已被 ×× 回答」关闭态
Given cursor 成员消息携带 askuser 标记
Then 群消息流渲染 marker 卡，任何成员发消息即作答（天然先到先得）

### FR-06: caps dialog 能力位
覆盖决策：D-005@v1
Given daemon/backend/frontend 三端 caps 表
Then 新增 dialog: 'native'|'marker'|'none'（claude/codex/pi=native、cursor=marker 或 none）；未知 provider 回退 'none'；三端对齐测试解析器扩展 string 值并通过

## 非功能需求

- 兼容性：未启用路径（claude/codex 既有、caps=none、旧 daemon）行为与今日一致；普通单聊答题授权语义不变
- 可回退：pi 桥接 fail-closed 自动取消兜底保留；cursor 整体可独立不启用；群聊授权放开为独立提交可单独回退
- 可测试：daemon 单测（pi 四态/注入）、前端单测（解析正反例/卡片/聚合/越权反例）、backend 单测（授权双条件/answered_by）、三波真机冒烟

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | （流程） | 单变更三波，plan 阶段映射 |
| D-002@v1 | FR-01, FR-02 | pi 桥接形态/永久等待/权限红线 |
| D-003@v2 | FR-03, FR-04 | 纯前端标记协议 + spike 门槛 + 降级 |
| D-004@v2 | FR-05 | 任何成员可答 + 授权放开 + 推荐人 |
| D-005@v1 | FR-06 | caps 三端能力位 |
| D-006@v2 | FR-03, FR-05 | 管道复用 + 授权放开唯一例外 |
| D-007@v1 | FR-01（结构） | 端头直挂同构架构 |
