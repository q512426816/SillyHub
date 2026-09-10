---
author: qinyi
created_at: 2026-09-10 11:41:35
---
# 提案书（Proposal）

## 动机

「本地活动」zcode 会话的对话化/原文查看读 `~/.zcode/cli/rollout/model-io-sess_<id>.jsonl`
短命文件——zcode 客户端在会话结束后很快清理（实测本机仅存 3 个活跃会话文件，半小时前
的已消失），导致隔天点开历史会话即报「日志文件在目标机器上不存在」，本地活动回看功能
对历史会话完全失效。

实证发现 zcode 自带本地长期库 `~/.zcode/cli/db/db.sqlite`（session/message/part 表，
1473 会话全量、与 message 表完全对齐、含已清理的死会话完整对话），且上报/发现/归属
链路无需变动——仅把**读取数据源**从文件切到库即可让全部历史会话复活。

## 关键问题

1. **文件生命周期与回看需求根本错配**：rollout model-io 文件以分钟/小时计被清理，
   而会话回看需求以天/周计；平台只存元数据不存内容，文件一清内容即永久丢失。
2. **报错体验误导**：CLI 上报时已带 `exists=false` 标记，但读取链路不消费——明知
   文件没了仍发起 RPC 得 404，且对话化失败后黄条承诺"回落原文尾部"但原文读同一
   个不存在的文件，双重报错。
3. **zcode 是唯一缺口**：claude（~/.claude/projects）与 codex（~/.codex/sessions）
   上报的本身就是月级长存文件，无此问题；为 zcode 引入服务端快照（用户已否决——
   不上传服务器、体积大）或 CLI 改造（动 sillyspec 仓 + 协议）均属过度。

## 变更范围

- sillyhub-daemon：新增 `read-zcode-sqlite` 读取器（node:sqlite 只读开库、sess id
  从上报路径提取、message+part 归一化为 NormalizedLogMessage、隐藏消息过滤、
  beforeSeq 窗口）；`readAgentLogMessages` 对 zcode format 先库后文件分派（守卫后、
  registry 前）；@types/node devDep bump。
- backend：`read_agent_log_content` 对 zcode format 先调 messages RPC 合成伪 jsonl
  （九字段封闭、不截断），失败回落 read_file 原路径（保留 256KB）。
- 测试：daemon 读取器 fixture 库用例 + 分派优先级用例；backend content 分支用例。

## 不在范围内（显式清单）

- 不动 sillyspec CLI（扫描/上报/协议零改动）
- 不动 frontend（无 UI 变化、不标注数据来源）
- 不动 liveness 五态（继续 tail 活跃文件）
- 不动 claude / codex 链路
- 不做服务端快照/归档/迁移（用户明确不上传服务器）
- 不做 zcode schema 版本探测（查询异常即回落）

## 成功标准（可验证）

- 文件已清理的历史 zcode 会话：对话化视图完整渲染（user/reply/thinking/工具段，
  无系统注入假气泡），原文视图返回合成伪 jsonl，均不再报"文件不存在"
- 活跃会话同样走库，「加载更早」翻页正常
- 库读失败回落矩阵全态有定义：库成功不碰文件 / 库失败文件在=成功 / 双失败=现状
  错误 / node:sqlite 不可用=全走文件
- claude/codex 会话查看行为逐字节不变
- daemon/backend 既有测试零回归（仅新增用例）
