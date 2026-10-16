---
author: agent
created_at: 2026-10-16T08:32:38.925Z
---
# 任务注册表（Tasks）— 2026-10-16-provider-switch-transcript-sanitize

- [x] task-01: 平台内切换供应商（reload 检测到 provider 变更）时，resume 前对 claude transcript 做历史清洗：把 server_tool_use / mcp_tool_use 块及引用它们的配对结果块替换为等价 text 块，保留原文本信息；原文件先备份；记录条数与 uuid/parentUuid 链不变；清洗失败仅 warn，绝不阻断 reload（新增 src/interactive/transcript-sanitize.ts + session-manager.ts `_reloadSessionNow` 接线 + `_sanitizeSwitchedTranscript`）
- [x] task-02: 实证形态可修：对 f231ca18 的 transcript 清洗后，出站请求不再含 server_tool_use、不再有无配对 tool_result，且真实供应商（MiniMax Anthropic 兼容端点）接受该请求（实测证据：真机修复 replacedBlocks=4 + 备份；抓包 637 消息 309/309 配平；真实端点对照 原形态 400 / text 形态 200）
- [x] task-03: 可读性：模型错误分类器识别该 400 签名，给出可执行中文提示（不再落兜底 运行失败 / hint=null），且不新增 ModelErrorType（daemon/backend/frontend 三端契约零变更）
- [x] task-04: 守护测试：清洗内核覆盖 配对 / 同消息 / 无脏块 三类形态 + 记录链路完整 + 备份存在；分类器签名用例；相关 daemon 测试绿、tsc 零错（transcript-sanitize 13 例含并发追加放弃与非文本如实标注 + SAN-1/2/3 + 分类器 3 例；interactive 套件 79 文件 1278 例绿 + tsc 零错；独立评审两轮 PASS：首轮 47249a13 四条发现全修，二轮 f5d12dbd 三条 P3 收口）
