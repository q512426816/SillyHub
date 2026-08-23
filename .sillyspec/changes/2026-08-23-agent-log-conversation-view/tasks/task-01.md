---
id: task-01
title: 'daemon zcode 解析器——统一 offset 对齐合并（full/delta/tail）+ 消息形状段产出（消息级 toolCalls/reasoning/字符串 content）+ system/reminder 剥离 + 末行 response 补尾去重 + 20MB 预算与坏行容错 + 200 段窗口与 before_seq 切片 + 真实形状 fixture 单测'
title_zh: 'daemon zcode 解析器——统一 offset 对齐合并（full/delta/tail）+ 消息形状段产出（消息级 toolCalls/reasoning/字符串 content）+ system/reminder 剥离 + 末行 response 补尾去重 + 20MB 预算与坏行容错 + 200 段窗口与 before_seq 切片 + 真实形状 fixture 单测'
author: 'qinyi'
created_at: 2026-08-23 21:24:18
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1, D-002@v1, D-006@v1]
allowed_paths:
  - sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts
  - sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts
provides:
  - contract: NormalizedLogMessage
    fields: [seq, kind, text, tool_name, tool_use_id, tool_input, tool_result, is_error, ts]
goal: >
  新增 daemon 侧 zcode model-io JSONL 解析器（纯函数），按 design §5.1 统一 offset
  对齐合并（full/delta/tail 无分支）+ 真实消息形状段产出（消息级 toolCalls/reasoning/
  字符串 content），输出 snake_case 的 NormalizedLogMessage[]（含 200 段窗口与
  before_seq 切片、20MB 预算与坏行容错、system/reminder 剥离、末行 response 补尾
  去重），为 task-02 的 host_fs.read_agent_log_messages RPC 与前端对话化渲染（FR-01）
  提供 KB 级归一化消息（FR-02，替代 256KB 原文尾部口径）。
implementation:
  - 新建 src/agent-log/parse-zcode-model-io.ts——定义并导出 NormalizedLogMessage（design §7.1 九字段 snake_case：seq/kind/text/tool_name/tool_use_id/tool_input/tool_result/is_error/ts）与解析结果类型（status/messages/truncated/totalSegments/skippedLines，外层 camelCase 对齐 §7.1）
  - 纯函数签名（content 字符串 + options 注入）——不读 env/时钟/文件系统；20MB 上限、200 段窗口、5s 超时 deadline 等全参数注入，默认值模块常量，fixture 单测零 mock
  - 20MB 预算前置判定——入参 content 超限直接返回 status:'too_large'（messages 空），不进入逐行解析（R-02）
  - 逐行 JSON.parse + 结构校验（type=model_io、request 存在、messages 为数组、messageOffset 为非负整数）——坏行跳过计 skippedLines 不中断；坏行占比 >50% 返回 status:'parse_error'（R-01）
  - 统一 offset 对齐合并（D-006 裁决一）——维护全局数组 G，逐行执行 G[messageOffset + i] = messages[i]，full（offset=0）/delta（offset>0 增量，len=0 合法）/tail（滑动尾部）三种 messagesKind 无分支统一覆盖，行序后写覆盖取最新（R-06 未实证假设按此处理）
  - 段产出（按 index 升序遍历 G，跳过空洞 index 后 seq 重编号）——user 消息 content 为纯字符串，剥 <system-reminder>…</system-reminder> 块后非空才产 user_input 段；assistant 消息 content 块 {type:'text'}→reply、{type:'reasoning'}→thinking，消息级 toolCalls[] 逐个产 tool_use 段（id/name/input，input 取 JSON.stringify 摘要截断 2KB）；tool 消息消息级 {toolCallId, toolName, isError, content} 产 tool_result 段（toolCallId→tool_use_id 配对键，content 摘要截断 4KB，isError→is_error）；role=system 跳过不产段；ts 取所属行 completedAt
  - 末行 response 补尾去重（Grill B1.4）——G 为历史权威，仅末行 response 补产段（text→reply、toolCalls→tool_use），补产前与 G 尾部 assistant 段同文比对，重复则跳过
  - 200 段窗口（FR-05）——总段数超 200 截最近 200 段 + truncated:true，totalSegments 记全量总数；beforeSeq 非空时按 seq < beforeSeq 切片后套窗口（daemon 无状态重解析口径，R-07 翻页不连续由 truncated 兜底）
  - 行级批处理每 500 行 yield（防 20MB 内大文件阻塞事件循环）+ 5s 超时保护 → status:'parse_error'（R-02）
  - 新建 tests/agent-log/parse-zcode-model-io.test.ts——真实形状 fixture（按 §5.1 两份真实日志实证事实构造，非编造）：full/delta(len=0)/tail 交错对齐、消息级 toolCalls、字符串 content、system-reminder 剥离、末行 response 补尾、同文去重、坏行>50%、20MB 上限、before_seq 切片、窗口空洞跳过重编号
acceptance:
  - full/delta(len=0)/tail 交错 fixture 经统一 offset 对齐合并后 G 序列正确（后写覆盖取最新，代码无 messagesKind 分支）
  - user 字符串 content / assistant 消息级 toolCalls + text/reasoning 块 / tool 消息级 toolCallId/toolName/isError 键集 → 段产出 kind 与九字段（snake_case）正确
  - role=system 消息、user 内 <system-reminder> 块、剥离后为空的 user 消息永不出现在输出任何字段（R-04 铁律）
  - 末行 response 补产 reply/tool_use 段；G 尾部存在同文 assistant 段时补产被去重跳过
  - 单行坏 JSON/缺 request 行计 skippedLines 且解析不中断；坏行 >50% → status:'parse_error'
  - content 超 20MB → status:'too_large' 且 messages 为空
  - 总段数 >200 → 仅返回最近 200 段且 truncated:true、totalSegments 为全量总数；beforeSeq 切片返回 seq < beforeSeq 的最近 200 段
  - tool_input 摘要截断 2KB / tool_result 截断 4KB；ts 为所属行 completedAt
verify:
  - cd sillyhub-daemon && pnpm test tests/agent-log/parse-zcode-model-io.test.ts
  - cd sillyhub-daemon && pnpm test
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - ESM import 一律带 .js 后缀（CONVENTIONS 13）
  - 解析器纯函数无副作用——不读 env/时钟/文件系统，20MB 上限、200 段窗口、beforeSeq、超时 deadline 全参数注入（默认值常量化），fixture 测试零 mock
  - 坏行（JSON.parse 失败/结构不符）占比 >50% → status:'parse_error'；≤50% 跳过计 skippedLines 不中断整体
  - system 消息与 <system-reminder> 块永不进 NormalizedLogMessage，剥离后为空整消息丢弃（design R-04）
  - 20MB 上限与 5s 超时保护（R-02）——超限/超时以 status:'too_large'/'parse_error' 结构化返回，不抛异常
  - 本 task 只触碰解析器与其测试两个文件——不建 registry、不改 host-fs-handler.ts/daemon.ts（task-02 所有）；解析器不 import RpcError/ws-client（错误只走 status 分层）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
