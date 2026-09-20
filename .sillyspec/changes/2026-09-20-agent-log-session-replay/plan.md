---
plan_level: full
---

# 实现计划（Plan）— 本地 Agent 会话回放按会话样式渲染 + 多 harness 解析器矩阵

> 变更：2026-09-20-agent-log-session-replay（实施基线：worktree replay-redo @53c67e02a，代码全走工作树绝对路径，SillySpec CLI 在主仓根跑）

## Wave 1（并行，无依赖）
- task-01
- task-02
- task-03

## Wave 2（依赖 Wave 1）
- task-04
- task-05

## Wave 3（依赖 Wave 2）
- task-06

## Wave 4（依赖 Wave 3）
- task-07

## Wave 5（依赖 Wave 4）
- task-08

## Wave 6（依赖 Wave 5）
- task-09

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | zcode 解析器字段扩展 | W1 | P0 | — | FR-03 | usage/turn_id/model/is_meta/turn_end + totalUsage，内层 snake_case 直通；fixture 测试同步 |
| task-02 | claude-code-jsonl 解析器 | W1 | P0 | — | FR-02, FR-03 | 新文件；行过滤/段映射/usage 全量口径归一（input+cache_read+cache_creation）/isMeta/真人切轮 |
| task-03 | cursor-agent-transcript 解析器 | W1 | P0 | — | FR-02 | 新文件；{role,message} 行 + turn_ended 切轮（turn_end 位）；usage/totalUsage 恒缺省 |
| task-04 | db.sqlite token 实证 + 读取器透传 | W2 | P0 | task-01 | FR-03 | 本机只读实证 step-finish token 可得性（结论落 QUICKLOG）；可得→透传/不可得→缺省，双分支测试 |
| task-05 | registry 注册 + RPC 透传 | W2 | P0 | task-01, task-02, task-03 | FR-02, FR-03 | PARSERS 增两 key；host-fs-handler 透传确认；read-agent-log-messages 测试 |
| task-06 | backend schema/router + gen:types | W3 | P0 | task-05 | FR-03 | AgentLogUsage/totals/五新字段（messages 内层零改名，外层仅 totalUsage→totals）；测试；worktree PYTHONPATH 坑下重生成 openapi.json+api-types.ts |
| task-07 | 前端适配层 | W4 | P0 | task-06 | FR-01, FR-02, FR-03 | NEW agent-log-replay.ts 纯函数：系统事件→stderr 首项/双保险切轮/轮 token 求和/主子日志判定/多主日志排序；单测 |
| task-08 | 回放主体组件 + 挂载点 | W5 | P0 | task-07 | FR-01, FR-02, FR-03, FR-04 | NEW agent-log-replay-body.tsx（数据链最早窗口落点上限 10 页/顶部条+工作会话浮层+用量汇总/TurnTimeline 挂载/回落与离线态）；page:3520+dialog:1913 挂载；AgentLogSessionBody 删除+三处注释同步+agent-log-card.test.tsx AgentLogSessionBody 用例组迁移/删除；组件 smoke（page+dialog 两分支） |
| task-09 | scoped 收口 | W6 | P0 | task-01~task-08 | 全 FR | daemon tests/agent-log 5 文件 + backend test_agent_log_messages + 前端 3 组 + tsc --noEmit 全绿；worktree git status 干净 |

## 关键路径
task-01 → task-05 → task-06 → task-07 → task-08 → task-09（六 Wave 串行链，最短交付周期由链长决定；task-02/03/04 为旁路汇入）

## 全局硬约束（从 design.md 抄录，绑定所有 task）
- daemon 消息级含 usage 内层键**全 snake_case 直通**（input_tokens/output_tokens/cache_read_tokens/cache_write_tokens），经 RPC 原样序列化零改名；外层键 camelCase（totalUsage），router 转换层**仅补外层 totalUsage→totals 一行映射**。
- usage 归一**全量口径**：input_tokens = 原始 input + cache_read + cache_creation（claude-code 归一；zcode 原生已满足不重算）。
- 预算/窗口协议不变：20MB 内容预算 / 200 段窗口 / 5s 解析超时 / beforeSeq 切片——**不新增端点、不新增 RPC 参数**。
- TurnTimeline **零改动**：系统事件落 SessionProcessItem kind:'stderr' 首项（⚙ 前缀）；SessionTurnView 必填八字段 runId/turn(null 合法)/prompt(string，系统触发轮 '')/output(空串)/status:'completed'/seenLogIds(空 Set)/inputTokens/outputTokens(无 usage→null)。
- 主日志判定：session_id 或 log_path 含 `subagent` → 工作会话；子代理日志不并入正文。
- 双主题铁律：新 UI 用 brand-* 语义阶与主题 token，不硬编码 hex。
- api-types.ts 必须由 `pnpm gen:types` 生成禁止手写；worktree 内跑生成链必须 `PYTHONPATH=<worktree>/backend`（主仓 venv editable 陷阱）；openapi.json + api-types.ts 随变更提交。
- 禁止跑全量测试，仅跑 scoped（daemon tests/agent-log、backend platform_sync/test_agent_log_messages.py、前端本变更 3 组测试文件）；全量留给 CI。
- 代码全部写入 worktree `C:\Users\qinyi\IdeaProjects\multi-agent-platform-replay-redo`（分支 replay-redo）；SillySpec CLI 一律在主仓根目录跑，永不 `cd` 进 worktree。
- 提交声明必须 `git show <hash> --stat` 复核（quicklog 虚报坑纪律）。
- 非目标边界：不做 L3 落库 / cursor provider 化 / cursor IDE store.db 对话化 / sillyspec 仓扫描上报层 / 不动已激活 tool_report 会话形态。

## 全局验收标准
1. scoped 单测全绿（task-09 清单）；
2. 打开 137ddfff 同型会话（tool_report 且 turn_count===0）：主体为会话样式对话流（系统事件行/真人用户气泡/思考折叠/工具卡片/轮 token 徽标/用量汇总条），子代理走「工作会话」入口；
3. 老 daemon mock（无新字段）token 显示「未知」不报错；422/unsupported/parse_error/too_large 回落原文黄条；离线态显示提示+元数据；
4. 已激活 tool_report、普通会话、群聊面板零回归（不触碰文件级验证 + 既有 scoped 测试绿）；
5. verify 阶段对照 requirements.md FR-01~04 逐条核验并写 verify-result.md。

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-07, task-08 | AC-2（TurnTimeline 直适配主体） |
| FR-01 | task-07, task-08 | AC-2 / 组件 smoke 两分支 |
| FR-02 | task-02, task-03, task-05, task-07, task-08 | 解析器 fixture + 系统事件单测 |
| FR-03 | task-01, task-02, task-04, task-05, task-06, task-07, task-08 | 四层透传测试 + token 徽标/汇总 |
| FR-04 | task-08 | 回落/离线态 smoke |
