---
author: qinyi
created_at: 2026-08-23 21:12:30
---

# 决策记录（Decisions）— 2026-08-23-agent-log-conversation-view

## D-001@v1: 解析位置在 daemon 侧
- type: architecture
- status: accepted
- source: user
- question: 本地日志解析放哪一侧（daemon / backend / 前端）？
- answer: 用户拍板 daemon 侧（explore 轮 AskUserQuestion + 方案轮确认方案 A）。理由：daemon 是唯一能本地全量读文件的一侧；归一化后跨网络传输从 MB 级降到 KB 级；解析知识靠近文件访问且 daemon 已有 harness 格式经验。
- normalized_requirement: 解析必须在 daemon 完成（全量本地读 + 窗口重建 + 归一化），backend 纯透传，前端零格式知识。
- impacts: [FR-02, §5, §6 文件清单]
- evidence: 本 session AskUserQuestion 两轮（方向选择 + 方案 A 确认）；explore 调研结论
- priority: P0

## D-002@v1: MVP 解析范围仅 zcode model-io
- type: boundary
- status: accepted
- source: user
- question: 第一版支持哪些 harness 格式？
- answer: 用户选「先只做 zcode」——当前实际使用的工具，验证效果后再按解析器注册表扩展 claude-code/codex/pi。
- normalized_requirement: registry 仅注册 zcode-model-io-jsonl；其余 format 一律 unsupported → 前端回落原文；二进制格式维持 409。
- impacts: [FR-01, FR-04, §3 非目标, §5 registry]
- evidence: 本 session AskUserQuestion（MVP 范围）
- priority: P0

## D-003@v1: 解析失败回落原文 <pre>
- type: boundary
- status: accepted
- source: code
- question: 解析失败/格式不支持时用户体验？
- answer: 静默回落现有原文端点 + 面板黄条提示，不弹错误框——现状能力零损失，永远保底可看。
- normalized_requirement: 前端收到 unsupported/parse_error/HTTP 非 200 一律回落 GET content；旧端点保留不删。
- impacts: [FR-03, §9 兼容策略]
- evidence: explore 结论 + 方案 A 选项描述（用户选择即接受）
- priority: P1

## D-004@v1: 方案 A（daemon 解析）正式确认
- type: architecture
- status: accepted
- source: user
- question: 三方案（A daemon / B backend / C 前端）选哪个？
- answer: 方案 A。B 违反 D-001（MB 级过 ws rpc + 256KB 截断口径推翻）、C 违反 D-001（原文进浏览器主线程 + 格式知识不合层）。
- normalized_requirement: 同 D-001，四段式落地（daemon 解析器+RPC / backend 透传端点 / 前端对话渲染+回落 / 三侧测试）。
- impacts: [§5 总体方案]
- evidence: 本 session AskUserQuestion 方案选择轮
- priority: P0

## D-005@v1: 四段式设计 + 原型确认
- type: architecture
- status: accepted
- source: user
- question: 分段展示的设计方案与 HTML 原型是否认可？
- answer: 用户确认「确认，继续」。含：对话化展开（工具卡片/思考折叠/对话-原文切换/加载更早）+ 回落态两段原型。
- normalized_requirement: design.md §5-§7 按确认稿落；原型文件 prototype-agent-log-conversation-view.html 为 execute 阶段 UI 对照基准。
- impacts: [FR-01, FR-05, §6, §7]
- evidence: 本 session AskUserQuestion 设计确认轮
- priority: P0

## D-006@v1: Design Grill 三裁决（B1/B2/B3 修正）
- type: architecture
- status: accepted
- source: code
- question: 独立审查判定 fail 的三个阻断项如何裁决？
- answer: ①格式事实重写：messagesKind 实测为 full|delta|tail 三值（非两值），合并规则统一为「一切窗口按绝对 offset 对齐覆盖」（G[offset+i]=msgs[i]）；消息形状按实测重写（assistant 仅 text/reasoning 块 + 消息级 toolCalls；tool 消息消息级 toolCallId/toolName/isError + 字符串 content；user 字符串 content）；response 与窗口双源裁决=以 G 为历史权威、仅末行 response 补尾 + 同文去重。②前端渲染直构段列表复用 tool-renderers 导出组件，不走 session-log-assembler（其 AssemblerLogInput 无 kind 字段、classify 靠 channel+前缀协议，反向合成迂回且触发 AskUserQuestion 丢弃与 seenText 同文去重陷阱）；配对按 tool_use_id，失配渲染「结果未记录」非「执行中」。③错误双通道分层：not_found/forbidden 维持 daemon throw RpcError（backend 映射零改动复用）；解析结果（parsed/unsupported/parse_error/too_large）是成功 RPC 的 status 字段，HTTP 200 + 前端判断回落；schema 字段补齐 tool_input/tool_result/is_error 并与 daemon 产出逐字对齐（snake_case）。
- normalized_requirement: design.md §5.1/§7.1/§7.2/§7.3/§10（R-01/R-03/R-06/R-07）按本裁决落地；非目标新增「不复用 session-log-assembler」。
- impacts: [§3, §5.1, §7.1, §7.2, §7.3, §10]
- evidence: stage-review brainstorm-review-2026-08-23-205353（fail 清单 1-9 + B1-B3）；主代理对存活日志文件（43db6d5c/5e2ebe2b）python 逐行复证；session-log-assembler.ts:157-271 源码核对
- priority: P0
