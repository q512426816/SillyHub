## FR-interactive-001 所有 stage 统一 scan 模式
变更：2026-07-08-2026-07-08-daemon-permission-verify-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-08-2026-07-08-daemon-permission-verify-fix/requirements.md#FR-001
最近确认：af41fac1d

## FR-interactive-002 撤回 635c0d4a
变更：2026-07-08-2026-07-08-daemon-permission-verify-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-08-2026-07-08-daemon-permission-verify-fix/requirements.md#FR-002
最近确认：af41fac1d

## FR-interactive-003 sillyspec 临时路径放行
变更：2026-07-08-2026-07-08-daemon-permission-verify-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-08-2026-07-08-daemon-permission-verify-fix/requirements.md#FR-003
最近确认：af41fac1d

## FR-interactive-004 stage 状态回写
变更：2026-07-08-2026-07-08-daemon-permission-verify-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-08-2026-07-08-daemon-permission-verify-fix/requirements.md#FR-004
最近确认：af41fac1d

## FR-interactive-005 verify requires_worktree=false
变更：2026-07-08-2026-07-08-daemon-permission-verify-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-08-2026-07-08-daemon-permission-verify-fix/requirements.md#FR-005
最近确认：af41fac1d

## FR-interactive-006 人审入口保留
变更：2026-07-08-2026-07-08-daemon-permission-verify-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-08-2026-07-08-daemon-permission-verify-fix/requirements.md#FR-006
最近确认：af41fac1d

## FR-interactive-007 写安全兜底
变更：2026-07-08-2026-07-08-daemon-permission-verify-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-08-2026-07-08-daemon-permission-verify-fix/requirements.md#FR-007
最近确认：af41fac1d

## FR-interactive-008 上下文环显示最近一次调用的提示词大小
变更：2026-08-27-session-token-usage-fix
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 一个进行中/已完成的交互会话（daemon 已上报 ctx_tokens） 会话含子代理轮（子桶消息流） 历史会话（所有 run ctx_tokens 均为 N；When 用户查看会话面板上下文用量环 子代理桶 flush 消息到达 backend 用户查看环 环取最新非 null；Then 环分子 = displayTurns 逆序第一个非 null 的 ctxTokens（= 最近一次 API 调用 input+cache_read+cache_
全文：.sillyspec/changes/archive/2026-08-27-session-token-usage-fix/requirements.md#FR-01
最近确认：73a4eda3e

## FR-interactive-009 轮中实时值与终态值统一为本轮计费量口径
变更：2026-08-27-session-token-usage-fix
状态：active
摘要：默认场景
依据决策：D-001@v2、D-004@v1
场景正文：
- 场景：默认场景 — Given 新的一轮开始（_onResult 已清零 turn 级计数器） R-09 spike（execute 首任务）；When daemon 流式处理该轮的 message_start / message_delta 并周期 flush 轮终态 close_interactive_run；Then pendingUsage 的 input/output = 本轮至今累计（非会话累计），AgentRun 实时写回仅增不减；每轮徽标 ↑↓ 单调递增 input
全文：.sillyspec/changes/archive/2026-08-27-session-token-usage-fix/requirements.md#FR-02
最近确认：73a4eda3e

## FR-interactive-010 会话累计量与既有行为零回归
变更：2026-08-27-session-token-usage-fix
状态：active
摘要：默认场景
依据决策：D-001@v2、D-005@v1
场景正文：
- 场景：默认场景 — Given budget_tokens 已配置的会话 老 daemon（不发 ctx_tokens）与老数据（ctx_tokens NULL）；When 多轮对话（含子代理）后触发 _checkBudgetCutoff backend 提取 usage / 前端渲染；Then 预算聚合仍基于会话级累计计数器（input+output 口径不变），跨轮不漏计；turn 级计数器不参与折算（折算时轮已结束） 缺键跳过、NULL 不报错，既
全文：.sillyspec/changes/archive/2026-08-27-session-token-usage-fix/requirements.md#FR-03
最近确认：73a4eda3e

## FR-interactive-011 拆分范围限定
变更：2026-09-07-arch-large-file-split
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 三端会话域 8 个大文件与在途变更 8 个排除文件并存；When 执行拆分；Then 只触碰清单内 8 个目标文件及其新拆出子模块；daemon.ts、hub-client.ts、config.ts、protocol.ts、sillyspec-m
全文：.sillyspec/changes/archive/2026-09-07-arch-large-file-split/requirements.md#FR-01
最近确认：6dc466dee

## FR-interactive-012 三端兼容层——导入与 mock 零破坏
变更：2026-09-07-arch-large-file-split
状态：active
摘要：默认场景
依据决策：D-004@v1、D-006@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 现有 62 个 session-manager 引用方、23 个 task-runner 引用方、140 条 `@/lib/daemon` import（133；When 完成三端拆包（Python 同名包 / TS 瘦 facade / bundler 目录化） 方法体下沉到子模块 子模块对被 patch 符号经原模块命名空间延；Then 全部现有 import 语句、vi.mock 路径与模块形状原样工作；session-panel/index.tsx 再导出 7 符号（SessionPanel
全文：.sillyspec/changes/archive/2026-09-07-arch-large-file-split/requirements.md#FR-02
最近确认：6dc466dee

## FR-interactive-013 3 Wave 顺序交付
变更：2026-09-07-arch-large-file-split
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 三端拆分互不依赖；When 推进执行；Then 按 Wave 1 daemon → Wave 2 backend → Wave 3 frontend 顺序；每 Wave 结束该端定向测试全绿后才进入下一 Wa
全文：.sillyspec/changes/archive/2026-09-07-arch-large-file-split/requirements.md#FR-03
最近确认：6dc466dee

## FR-interactive-014 行数达标
变更：2026-09-07-arch-large-file-split
状态：active
摘要：默认场景
依据决策：D-005@v3
场景正文：
- 场景：默认场景 — Given 8 个目标文件当前行数（5438/3426/7176/5468/4844/4055/6620/4090）；When 拆分完成；Then 新拆出子模块 ≤800 行；原文件保留核心编排 ≤2500 行；两项显式豁免：session-panel-page.tsx ≤3000、session-pane
全文：.sillyspec/changes/archive/2026-09-07-arch-large-file-split/requirements.md#FR-04
最近确认：6dc466dee

## FR-interactive-015 轻重构白名单 6 项
变更：2026-09-07-arch-large-file-split
状态：active
摘要：默认场景
依据决策：D-002@v1、D-005@v3
场景正文：
- 场景：默认场景 — Given 白名单外禁止顺手改（Non-Goals 4+ 项成文）；When 执行轻重构；Then 只完成：① daemon payload-utils 统一鸭子读取器；② event-wire 收敛平行转换；③ backend 后台任务 mixin；④ Re
全文：.sillyspec/changes/archive/2026-09-07-arch-large-file-split/requirements.md#FR-05
最近确认：6dc466dee

## FR-interactive-016 行为零变化验收
变更：2026-09-07-arch-large-file-split
状态：active
摘要：默认场景
依据决策：D-006@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 现有测试套件（daemon 62+23 相关、backend daemon/tests 约 70 相关、frontend components/daemon/_；When 拆分完成；Then 全部相关测试文件内容不变且通过；daemon/backend/frontend 各端类型检查与 lint 通过；backend openapi.json 拆分前
全文：.sillyspec/changes/archive/2026-09-07-arch-large-file-split/requirements.md#FR-06
最近确认：6dc466dee

## FR-interactive-017 pi 轮中阻塞提问
变更：2026-09-09-askuser-pi-cursor
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given pi 会话运行中且 Wave A 已启用（caps dialog=native、permission_dialog=true）；When pi extension 层发起 dialog 类 ui_request（select/confirm/input/editor） 用户在提问卡提交回答
全文：.sillyspec/changes/archive/2026-09-09-askuser-pi-cursor/requirements.md#FR-01
最近确认：c3cf236ad

## FR-interactive-018 pi 桥接安全与生命周期语义
变更：2026-09-09-askuser-pi-cursor
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given pi dialog 挂起等待中；When 用户长期不作答 会话 end/fail 或驱动 close/abort pi 发起权限类 extension 请求或未知方法；Then 永久等待（对齐平台 dialog 不超时语义），无 5min/30min 强制超时 挂起表统一回 cancelled:true，pi 进程收到取消正常收尾 维持
全文：.sillyspec/changes/archive/2026-09-09-askuser-pi-cursor/requirements.md#FR-02
最近确认：c3cf236ad

## FR-interactive-019 cursor 纯前端标记提问
变更：2026-09-09-askuser-pi-cursor
状态：active
摘要：默认场景
依据决策：D-003@v2、D-006@v2
场景正文：
- 场景：默认场景 — Given cursor 会话且 spike 达标（caps dialog=marker） 标记非法（JSON 坏/必填缺失/超 4KB/非尾部）；When agent 回复文本尾部携带合法 ```askuser JSON 标记 用户在标记卡提交选择/输入；Then 标记随文本原样持久化（不剥离、无后端 dialog 行）；前端在单聊时间线渲染提问卡并隐藏标记原文（流式与历史同一解析器） 答案组装为下一条用户消息走既有发送链
全文：.sillyspec/changes/archive/2026-09-09-askuser-pi-cursor/requirements.md#FR-03
最近确认：c3cf236ad

## FR-interactive-020 cursor spike 门槛与降级
变更：2026-09-09-askuser-pi-cursor
状态：active
摘要：默认场景
依据决策：D-003@v2
场景正文：
- 场景：默认场景 — Given Wave B 编码前；When 真机 10 次澄清场景测试；Then 合法标记 ≥8/10 判达标启用 prompt 注入与 marker 卡；<8/10 则不注入 prompt、caps=none，解析器与卡片代码保留（协议资产
全文：.sillyspec/changes/archive/2026-09-09-askuser-pi-cursor/requirements.md#FR-04
最近确认：c3cf236ad

## FR-interactive-021 群聊聚合与任何成员先到先得
变更：2026-09-09-askuser-pi-cursor
状态：active
摘要：默认场景
依据决策：D-004@v2、D-006@v2
场景正文：
- 场景：默认场景 — When 任意群成员（非群主）提交回答 另一成员随后再提交；Then 群聊流内渲染提问卡（成员 agent 来源标注 + recommendResponders 推荐 @条） 放行（授权门双条件：群聊影子会话 + 答题者为该群成员
全文：.sillyspec/changes/archive/2026-09-09-askuser-pi-cursor/requirements.md#FR-05
最近确认：c3cf236ad

## FR-interactive-022 caps dialog 能力位
变更：2026-09-09-askuser-pi-cursor
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given daemon/backend/frontend 三端 caps 表；Then 新增 dialog: 'native'|'marker'|'none'（claude/codex/pi=native、cursor=marker 或 none）
全文：.sillyspec/changes/archive/2026-09-09-askuser-pi-cursor/requirements.md#FR-06
最近确认：c3cf236ad

## FR-interactive-023 pi 会话上下文用量
变更：2026-09-13-ctx-usage-all-providers
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given pi 会话完成一轮含工具调用的对话（turn_end 携带 usage） pi 错误轮 turn_end usage 全零；When 归一化器构造 usage 快照事件；Then `usage.ctx_tokens = input + cacheRead + cacheWrite`（净值三和，pi-ai 全 provider 净值口径），
全文：.sillyspec/changes/archive/2026-09-13-ctx-usage-all-providers/requirements.md#FR-01
最近确认：40eecd92c

## FR-interactive-024 cursor 会话上下文用量
变更：2026-09-13-ctx-usage-all-providers
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When `mapUsage` 映射字段；Then `ctx_tokens = inputTokens + cacheReadTokens + cacheWriteTokens`；头注释「cursor 侧无 ct
全文：.sillyspec/changes/archive/2026-09-13-ctx-usage-all-providers/requirements.md#FR-02
最近确认：40eecd92c

## FR-interactive-025 codex 会话上下文用量
变更：2026-09-13-ctx-usage-all-providers
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given codex 每次 API 调用后发 `thread/tokenUsage/updated` 通知（total 线程累计 / last 单调用，inputToke；When `_extractTokenUsage` 解析；Then 存 `lastCallCtxTokens = last.inputTokens`（毛值直取）；`_usageDelta`（usage_update 载体）与 `
全文：.sillyspec/changes/archive/2026-09-13-ctx-usage-all-providers/requirements.md#FR-03
最近确认：40eecd92c

## FR-interactive-026 ProviderCaps 第 11 键 ctx_usage 三端贯通
变更：2026-09-13-ctx-usage-all-providers
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given providers.ts 单源 ProviderCaps 加 `ctx_usage: boolean`、四引擎 true、未知回退 false 新引擎接入 IN；When gen-provider-caps.mjs 生成（CAPS_KEYS + renderFrontend 模板接口体 + 回退字面量 + 三处「10 键」文案同步；Then frontend/provider-caps.ts 与 backend/provider_caps.py 两份 @generated 产物含新键；双守护测试（a
全文：.sillyspec/changes/archive/2026-09-13-ctx-usage-all-providers/requirements.md#FR-04
最近确认：40eecd92c

## FR-interactive-027 派生公式单源
变更：2026-09-13-ctx-usage-all-providers
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 新增 `usage-ctx.ts` 共享 helper（`ctxTokensFromNetInput` 净值三和 / `ctxTokensFromGrossIn；When claude/pi/cursor 派生与 codex 取值；Then 均引用 helper（claude :946 求和处改调，行为零变化；差分路径维持原样注释锚定）；口径一处定义
全文：.sillyspec/changes/archive/2026-09-13-ctx-usage-all-providers/requirements.md#FR-05
最近确认：40eecd92c

## FR-interactive-028 前端 caps 门控
变更：2026-09-13-ctx-usage-all-providers
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given CtxUsageBar 加 `provider?: string | null` prop（全仓调用点仅 frontend/src/components/dae；When `provider != null && !getProviderCaps(provider).ctx_usage`；Then 只渲染 QuotaPill 不渲染环；provider 为 null/未知 → 照常渲染环（本机默认供应商不回归）
全文：.sillyspec/changes/archive/2026-09-13-ctx-usage-all-providers/requirements.md#FR-06
最近确认：40eecd92c

## FR-interactive-029 真机验证
变更：2026-09-13-ctx-usage-all-providers
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本机 codex-cli 0.147.0 与 pi 0.81.1；When 真机各跑一轮含工具调用会话；Then codex 抓 `thread/tokenUsage/updated` 确认 `last` 形态与取值（结论记 QUICKLOG）；pi 复核 turn_end
全文：.sillyspec/changes/archive/2026-09-13-ctx-usage-all-providers/requirements.md#FR-07
最近确认：40eecd92c

## FR-interactive-030 caps 第 13 键+codex thinking 翻值
变更：2026-09-14-session-thinking-level
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given ProviderCaps 加 thinking_level 键（claude/pi/codex=true、cursor=false）；When gen 脚本三端生成+守护同步；Then 前端门控/后端校验有真数据源；codex thinking 翻 true（纯声明对齐）
全文：.sillyspec/changes/archive/2026-09-14-session-thinking-level/requirements.md#FR-01
最近确认：28915f71b

## FR-interactive-031 统一七档词表与映射
变更：2026-09-14-session-thinking-level
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given THINKING_LEVELS 七档常量+mapPlatformLevelToEngine 映射矩阵；When 各 driver 消费；Then 引擎不支持档位按降级规则映射（off→不设、minimal→low、max→xhigh）+矩阵单测全绿
全文：.sillyspec/changes/archive/2026-09-14-session-thinking-level/requirements.md#FR-02
最近确认：28915f71b

## FR-interactive-032 创建时选档全链
变更：2026-09-14-session-thinking-level
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端 preThinkingLevel→createSession；When 全链五跳透传（schema→create→placement→lease→daemon→driver）；Then 三 driver 启动设置生效（claude options.effort/codex turn params/pi 握手后命令）
全文：.sillyspec/changes/archive/2026-09-14-session-thinking-level/requirements.md#FR-03
最近确认：28915f71b

## FR-interactive-033 动态档位查询
变更：2026-09-14-session-thinking-level
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 会话存在且 caps=true；When GET /sessions/{id}/thinking-levels；Then 返回 {levels, current}——pi 按模型动态/claude supportedModels 过滤/codex 五档
全文：.sillyspec/changes/archive/2026-09-14-session-thinking-level/requirements.md#FR-04
最近确认：28915f71b

## FR-interactive-034 会话中切换
变更：2026-09-14-session-thinking-level
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given turn 空闲+合法档位；When POST /sessions/{id}/thinking-level；Then 三引擎切换生效（pi 命令/claude applyFlagSettings/codex settings/update）+成功通知
全文：.sillyspec/changes/archive/2026-09-14-session-thinking-level/requirements.md#FR-05
最近确认：28915f71b

## FR-interactive-035 前端双控件
变更：2026-09-14-session-thinking-level
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given caps.thinking_level=true；When 创建表单（静态七档+off 显示"默认"+语义差异 tooltip）/会话配置条（动态档位+现值+running 禁用）；Then 切换成功通知+失败带原因
全文：.sillyspec/changes/archive/2026-09-14-session-thinking-level/requirements.md#FR-06
最近确认：28915f71b

## FR-interactive-036 真机验证
变更：2026-09-14-session-thinking-level
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 三引擎会话；When 各创建选档+查询+切换；Then 档位生效（真机回执记 QUICKLOG；spike-01 codex 形状/spike-02 claude applyFlagSettings）
全文：.sillyspec/changes/archive/2026-09-14-session-thinking-level/requirements.md#FR-07
最近确认：28915f71b
