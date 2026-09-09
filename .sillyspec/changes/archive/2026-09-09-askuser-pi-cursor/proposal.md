---
author: qinyi
created_at: 2026-09-09 22:50:06
---
# 提案书（Proposal）

## 动机

平台「agent 向用户提问」（AskUser）的中间管道（提交/持久化/前端卡片/应答回流）是引擎无关通用件，但端头只有 claude（SDK 钩子）与 codex（app-server request_user_input）接通；pi 的 RPC dialog 请求被一律自动取消，cursor 无头模式无通道，群聊面板看不到成员提问。用户要求 pi/cursor 具备提问能力、群聊可见可答（任何成员先到先得 + agent 推荐艾特回答人）。

## 关键问题

1. pi 的 `extension_ui_request` dialog 类（select/confirm/input/editor）在驱动内被自动回 cancelled（permission_dialog=false，pi-onboarding 明言「桥接留后续」）——有真通道没用上。
2. cursor 无头 CLI 无任何对话/审批通道，且后端 dialog 管道三处「run 存活」不变量（提交需活跃轮/终态轮孤儿卡过滤/答题需活跃轮）使「轮界提问挂 pending 卡」不可行——需要一条不依赖 run 生命周期的协议（纯前端标记渲染）。
3. 群聊影子会话答题授权为群主/admin 专属、`answered_by` 记群主失真——与「任何成员先到先得」产品要求冲突。

## 变更范围

- Wave A：pi RPC dialog 桥接（照 codex 模板，dialog_kind=pi_extension_ui，永久等待+中止兜底，权限类零桥接红线）。
- Wave B：cursor 纯前端标记协议（```askuser JSON 尾块标记即数据；前端解析渲染卡；提交=答案作下一条消息 --resume 续轮；spike ≥8/10 门槛 + 降级）。
- Wave C：群聊聚合（成员 pending 原生卡 + marker 卡）、影子会话答题授权放开（session_kind='group_member' 判别 + 群成员校验）、answered_by 实际答题人。
- caps 三端 `dialog: native|marker|none` 能力位（对齐测试解析器同步扩展）。

## 不在范围内（显式清单）

- 不做 cursor 轮中阻塞（无头 CLI 做不到）
- 不做群聊「仅定向人可答」硬门控（推荐人是软提示）
- 不改 dialog 管道协议（唯一例外：影子会话答题授权分支，D-006@v2）
- 不做 pi 权限类请求桥接（安全红线）
- 不引入 DialogGateway 新抽象层（D-007 否决）
- 不做新引擎接入（gemini 等，后续按 caps 声明复用）

## 成功标准（可验证）

- pi 会话中 agent 提问 → 页面弹卡 → 作答后 pi 同轮继续（真机冒烟）
- cursor 会话中 agent 按标记格式提问 → 页面渲染提问卡（非裸 JSON）→ 提交后答案成为下一条消息且 agent 续答；spike 遵守率 ≥8/10，不达标则整体不启用（无 prompt 注入即无标记，行为同今日）
- 群聊流内可见成员提问卡；非群主成员可作答；后答者见「已被 ×× 回答」；推荐人 @提示渲染
- 未开启路径（claude/codex 既有会话、caps=none 引擎、普通单聊授权）行为与今日完全一致（回归全绿）
- caps 三端对齐测试通过（dialog string 枚举解析）
