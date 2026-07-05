---
author: qinyi
created_at: 2026-07-05 16:33:00
---

# SillySpec Quick Log

> 上一轮（2026-06-19 ~ 2026-07-05，310 行）已归档到 `QUICKLOG-qinyi-2026-07-05.md`。
> 新记录从此处继续。命名约定：`## ql-YYYYMMDD-NNN-xxxx | <本地时间> | <一句话摘要>`。

## ql-20260705-001-7c4a | 2026-07-05 17:04:05 | 修 backend token 守卫治 input_tokens 永久 NULL（Claude cache 全命中 input=0 被 >0 守卫误杀）
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/run_sync/service.py, backend/tests/modules/daemon/run_sync/
依据：daemon 四处字段对齐（stream-json.ts:1092 extractResultStats / daemon.ts:1315 onTurnResult / hub-client.ts:570 / backend _METADATA_FIELDS）均用 typeof/undefined 守卫不要求 >0；close_interactive_run:777 已用 is not None 正确；唯一病根是 submit_messages:337-348 的 >0 守卫。max 累积本身防御中间事件 0/0（0 不拉低已有值），去掉 >0 不引入回归。
修法：4 个守卫去掉 `and int(...) > 0`，保留 isinstance + max 累积；更新注释 225-228 说明 cache 全命中 input=0 合法。
测试：加 cache 全命中场景（input=0 + cache_read>0），断言 input_tokens 落 0 而非 NULL。

## ql-20260705-002-b8e1 | 2026-07-05 17:30:00 | 修前端 tool_kind 筛选守卫过严 + plan/ask/schedule 无按钮命中（C1+C2）
状态：已完成
关联变更：（无）
文件：frontend/src/components/agent-log-viewer.tsx, frontend/src/components/__tests__/agent-log-viewer-tool-kind.test.tsx
依据：agent-log-viewer.tsx:712 守卫 `p.log.tool_kind != null && activeToolKindFilters.has(p.log.tool_kind)` 致 tool_kind=null 的 tool_call 行在第二层 active 时被隐藏（C1）；toolKindFilters(770-782) 只列 11 个、14 枚举漏 plan/ask/schedule，注释声称"归其他"但选中"其他"时只匹配 tool_kind==='other'，plan/ask/schedule 行不命中（C2）。
修法：守卫改为"其他桶"逻辑——定义 OTHER_BUCKET={plan,ask,schedule,other}，选中"其他"时 null + OTHER_BUCKET 都匹配；选中具体类型时 null 不显示（合理）。
测试：加用例——null/plan 在选中"其他"时显示；null 在选中"命令行"时不显示。

## ql-20260705-003-c2d9 | 2026-07-05 17:45:00 | 减小 turn 卡片密度治 98 turn 大量空白（B）
状态：已完成
关联变更：（无）
文件：frontend/src/components/agent-log-viewer.tsx
依据：TurnBlock(540-615) 每个 turn 是 rounded-md border 卡片 + 头部 py-1.5 + 容器 space-y-2 p-2，98 turn 累积大量垂直空白（用户扫描 run 痛点：日志区"很多空白"）。
修法（用户 AskUserQuestion 选"减小卡片密度"）：去 turn 外边框（rounded-md border）改 border-b divider；头部 py-1.5→py-1；容器 space-y-2 p-2→space-y-0 p-1。不折叠内容，零交互风险。
测试：现有 agent-log-viewer 36 测试不回归（内容渲染不变，仅 class 调整）。

## ql-20260705-004-d73f | 2026-07-05 17:55:00 | 筛选标签加 count 数字（C6 增强）
状态：已完成
关联变更：（无）
文件：frontend/src/components/agent-log-viewer.tsx, frontend/src/components/__tests__/agent-log-viewer-tool-kind.test.tsx
依据：用户抱怨侧栏标签"数据缺失没正确展示"——实际是按钮从不渲染 count（设计如此），用户期望看到每类日志数量。第一层 10 个 semantic 标签 + 第二层 11 个 tool_kind 标签都加计数。
修法：useMemo 算 semanticCounts（按 semanticCategory）+ toolKindCounts（tool_call 行按 tool_kind，其他桶=null+plan/ask/schedule+other 与 ql-002 守卫一致）；count>0 时 label 后显示灰色数字。
测试：加用例验证 count 数字渲染（如 3 条 bash tool_call → 命令行按钮显示 3）。

## ql-20260705-005-e5a2 | 2026-07-05 17:50:00 | 前端输入词元合并 cache_read 治标签对应不上（C4）
状态：进行中
关联变更：（无）
文件：frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
依据：A(ql-001) 修 backend 让 input_tokens=0（Claude cache 全命中）能正确写入，但前端 page.tsx:708 守卫 `input_tokens > 0` 致 0 仍显示"执行中…"，与 output 数字不对称（用户"标签对应不上"抱怨的最后一环）。
修法：输入词元显示 input_tokens + cache_read_tokens 合并（总输入 token），total>0 显示数字否则 pendingMetric。cache 全命中时显示 cache_read 大数（直观，符合用户"总输入"直觉）。底部徽标仍分开显示 ↓input / ⚡cache_read 细节，互补。
测试：page.tsx 是 Next.js page 无直接单测；验证靠 typecheck + 部署后 curl/UI 手动看。

## ql-20260705-006-a1b7 | 2026-07-05 18:05:00 | classify 改主命令判定治 sillyspec 误归（C3 两端同步）
状态：进行中
关联变更：（无）
文件：backend/app/modules/agent/tool_kind.py, sillyhub-daemon/src/tool-kind.ts, backend/tests/modules/agent/test_tool_kind.py, sillyhub-daemon/tests/tool-kind.test.ts
依据：DB 实测 run be48ad3a 的 41 条 sillyspec 里 34 条（83%）是误归——都是 `python -c "..."` 生成 sillyspec 文档，脚本内容含 sillyspec 字样被 D-001"command 含子串即标"逻辑误判。D-001 基于"误标成本低"假设，实际误标率 83% 太高。
修法（推翻 D-001 子串语义，改主命令判定）：command 任一段（&&/;/|）的主命令是 sillyspec 才归 sillyspec；覆盖直接调用 + pnpm/npx/yarn/sudo/node 包装 + 复合命令。脚本内容/grep/cat 含 sillyspec 字样的不再误归。两端 PY+TS 同步 + 测试同步。
测试：改 SHARED_CASES + test_sillyspec_substring_semantics（cat sillyspec-note.md 从 sillyspec 改 bash）；加 python/grep 误归排除用例。





