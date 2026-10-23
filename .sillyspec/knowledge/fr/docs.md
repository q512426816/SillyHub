---
author: sillyspec-fr-index
created_at: 2026-10-15T16:16:15.707Z
---

# FR 索引 — docs

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/docs.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-docs-001 CONVENTIONS.md 原型管线指针节（必须）
变更：2026-10-16-proto-pipeline-discoverability
状态：active
摘要：主路径——agent 查本图 scan
场景正文：
- 场景：主路径——agent 查本图 scan — Given agent 在 multi-agent-platform 项目图下做 UI 变更，按规则读本图 scan CONVENTIONS.md；When 读到「前端原型管线」节；Then 拿到管线入口与规约指针，不再误判「项目无 React 原型管线」。
全文：.sillyspec/changes/archive/2026-10-16-proto-pipeline-discoverability/requirements.md#FR-01
最近确认：0e5d3f3b0b49be367746945232dc5ac7a0cb70c3

## FR-docs-002 local.yaml ui_prototype 登记（必须）
变更：2026-10-16-proto-pipeline-discoverability
状态：active
摘要：主路径——跨仓联动
场景正文：
- 场景：主路径——跨仓联动 — Given 本登记落盘且 sillyspec 新契约在位；When buildUiGuidanceLines(specBase) 渲染；Then 注入「🔒 真码契约（real-code）」行（readUiPrototypeForm 实测 registered real-code）。
全文：.sillyspec/changes/archive/2026-10-16-proto-pipeline-discoverability/requirements.md#FR-02
最近确认：0e5d3f3b0b49be367746945232dc5ac7a0cb70c3

## FR-docs-003 验证与零回归（必须）
变更：2026-10-16-proto-pipeline-discoverability
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 改动落盘；When readUiPrototypeForm 实测 + 平台仓门；Then registered=true、form=real-code；零代码 diff。
全文：.sillyspec/changes/archive/2026-10-16-proto-pipeline-discoverability/requirements.md#FR-03
最近确认：0e5d3f3b0b49be367746945232dc5ac7a0cb70c3

## FR-docs-004 session.workspace_id 为空的会话中，待决策 pill 正常渲染（只要有提问历史/pending）
变更：2026-10-16-decision-pill-no-workspace
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 会话 445e12d9（workspace_id 为空，存在 2 条已答 AskUser 提问）；When 用户打开 /sessions?session=445e12d9；Then 待决策 pill 渲染，展开已答历史列出 2 条（浏览器实测通过）
全文：.sillyspec/changes/archive/2026-10-16-decision-pill-no-workspace/requirements.md#FR-01
最近确认：256aa6feb2c4349f3d4a1b513e94fb9fa5fddd0e

## FR-docs-005 变更文件 pill 在无 workspace 会话维持不渲染（原有显隐契约不变）
变更：2026-10-16-decision-pill-no-workspace
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 同 FR-01 会话；When 页面渲染完成；Then data-testid=session-change-files-hover 不在 DOM（浏览器实测通过）
全文：.sillyspec/changes/archive/2026-10-16-decision-pill-no-workspace/requirements.md#FR-02
最近确认：256aa6feb2c4349f3d4a1b513e94fb9fa5fddd0e

## FR-docs-006 既有回归测试全绿
变更：2026-10-16-decision-pill-no-workspace
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 修复提交 9b5485fb0；When 跑相关 vitest 与 tsc --noEmit；Then 12/12 + 26/26 + 38 合并用例全绿、tsc 零错（实测通过）
全文：.sillyspec/changes/archive/2026-10-16-decision-pill-no-workspace/requirements.md#FR-03
最近确认：256aa6feb2c4349f3d4a1b513e94fb9fa5fddd0e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-decision-pill-no-workspace:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx | frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx | frontend/src/components/daemon/__tests__/session-panel-connection.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-decision-pill-no-workspace
  status: active

## FR-docs-007 daemon 重启载入时 dsh/zcode 会话记录通过 VALID_PROVIDERS 校验不再静默丢弃，守护测试断言白名单与驱动注册表键一致
变更：2026-10-17-audit-risk-followup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-audit-risk-followup/requirements.md#FR-01
最近确认：7faec5bfa12ed2e7159077f469589243fb36ee5b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-audit-risk-followup:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/session-store-persistence.test.ts「单源守护：INTERACTIVE_PROVIDERS 全部键的记录载入保留（2026-10-17-audit-risk-followup——手写白名单漏 dsh/zcode 曾致重启静默丢记录，pi/cursor 同坑各一次）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-audit-risk-followup
  status: active

## FR-docs-008 run 仍活跃（current_run_status 非 null）时不再误标「已执行完成」角标，活跃转 null 仍正确标记，测试覆盖 running 持续不标与 running 转 null 标记两态
变更：2026-10-17-audit-risk-followup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-audit-risk-followup/requirements.md#FR-02
最近确认：7faec5bfa12ed2e7159077f469589243fb36ee5b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-audit-risk-followup:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「run 跨刷新仍活跃（running→running，列表数据有变化）→ 不误标完成角标（活跃期误报回归）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-audit-risk-followup
  status: active

## FR-docs-009 登出清理注册表收录 sillyhub:session-completed-unread: 前缀，测试断言该前缀键被清理
变更：2026-10-17-audit-risk-followup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-audit-risk-followup/requirements.md#FR-03
最近确认：7faec5bfa12ed2e7159077f469589243fb36ee5b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-audit-risk-followup:flow:测试绑定FR-03
  tests: frontend/src/lib/__tests__/logout-storage.test.ts「7 类用户域前缀全清、设备级键保留、前缀精确匹配」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-audit-risk-followup
  status: active

## FR-docs-010 防复活抑制面改为 pre_swap 之后现算：下载窗口内重建的同名文件不再被本地删除、陈旧 manifest 条目不再并回，测试覆盖窗口内重建场景
变更：2026-10-17-audit-risk-followup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-audit-risk-followup/requirements.md#FR-04
最近确认：7faec5bfa12ed2e7159077f469589243fb36ee5b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-audit-risk-followup:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/pull-antiresurrect.test.ts「用例5（窗口内重建保护）：下载窗口内重建的同名文件不进抑制面——不删本地、不并回陈旧条目（2026-10-17-audit-risk-followup）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-audit-risk-followup
  status: active

## FR-docs-011 zcode consume finally 对齐 codex：清 _finishTurnOnClose 槽位并 await close，幂等不双重关闭
变更：2026-10-17-audit-risk-followup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-audit-risk-followup/requirements.md#FR-05
最近确认：7faec5bfa12ed2e7159077f469589243fb36ee5b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-audit-risk-followup:flow:测试绑定FR-05
  tests: sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts「consume 自然退出（iq.close）→ finally 对齐 codex：清 _finishTurnOnClose 槽位 + 兜底 close（幂等单次）（2026-10-17-audit-risk-followup）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-audit-risk-followup
  status: active

## FR-docs-012 applyResurrectSuppress 对越界（路径穿越）manifest 键跳过并告警，测试覆盖越界键不触发删除'
变更：2026-10-17-audit-risk-followup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-audit-risk-followup/requirements.md#FR-06
最近确认：7faec5bfa12ed2e7159077f469589243fb36ee5b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-audit-risk-followup:flow:测试绑定FR-06
  tests: sillyhub-daemon/tests/pull-antiresurrect.test.ts「用例6（越界键防线）：applyResurrectSuppress 对越界键（../）跳过 rm 并告警——dir 外文件幸存」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-audit-risk-followup
  status: active

## FR-docs-013 zcode 驱动 env 诊断日志的值统一走脱敏 helper：KEY/TOKEN 键整值 <redacted>，其余值内 scheme://user:pass@host 形态的 userinfo 段打码为 ***，普通值原样保留（诊断能力不回退）
变更：2026-10-18-audit-log-redact-yaml-quote
状态：active
摘要：代理 URL 凭据打码；KEY/TOKEN 整值脱敏
场景正文：
- 场景：代理 URL 凭据打码 — Given env 含 `HTTPS_PROXY=http://user:secret@proxy.example.com:3128` 与 `ANTHROPIC_BASE_；When zcode 会话 spawn 打印 env 诊断日志；Then 日志中代理值为 `http://***@proxy.example.com:3128`，BASE_URL 值原样保留。
- 场景：KEY/TOKEN 整值脱敏 — Given env 含 `ANTHROPIC_API_KEY=sk-xxx` 与 `ANTHROPIC_AUTH_TOKEN=tok-yyy`；When 同上；Then 日志中两键的值均为 `<redacted>`，密钥本体不落日志。
全文：.sillyspec/changes/archive/2026-10-18-audit-log-redact-yaml-quote/requirements.md#FR-01
最近确认：60f8d9e41e2ccb9446325a0679f0fb6a5ec2c31e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-18-audit-log-redact-yaml-quote:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts「redactEnvValueForLog 脱敏三态（代理 userinfo 打码/KEY-TOKEN 整值 <redacted>/普通值透传）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-18-audit-log-redact-yaml-quote
  status: active

## FR-docs-014 dsh cordis.patch.yml 的 model id/name 与 baseURL 一律 YAML 单引号包裹并按规范双写转义内嵌单引号，含冒号/空格/#/单引号的模型名不再破坏 YAML 结构
变更：2026-10-18-audit-log-redact-yaml-quote
状态：active
摘要：特殊字符模型名；常规值幂等
场景正文：
- 场景：特殊字符模型名 — Given provider 的 model 含 `: `（键值分隔）、`#`（注释起始）、`'`（单引号）等 YAML 特殊字符；When writeDshHome 写盘；Then patch 中该值被单引号包裹且内嵌单引号双写转义，YAML 结构不破坏（不产生多余键/注释吞噬后续行）。
- 场景：常规值幂等 — Given provider 为常规形态（model=deepseek-v4、baseURL=https://api.example.com/anthropic）；When writeDshHome 写盘；Then 输出为 `'deepseek-v4'` / `'https://api.example.com/anthropic'` 形态，同配置二次写内容一致（幂等语义不变
全文：.sillyspec/changes/archive/2026-10-18-audit-log-redact-yaml-quote/requirements.md#FR-02
最近确认：60f8d9e41e2ccb9446325a0679f0fb6a5ec2c31e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-18-audit-log-redact-yaml-quote:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/dsh-settings.test.ts「特殊字符模型名/URL 单引号转义不破坏 YAML」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-18-audit-log-redact-yaml-quote
  status: active

## FR-docs-015 新增单测钉板两处（zcode 脱敏 helper 纯函数用例 + dsh 特殊字符模型名写盘用例），既有用例断言同步更新，dsh-settings 与 zcode 驱动相关测试全绿，tsc 零错
变更：2026-10-18-audit-log-redact-yaml-quote
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-18-audit-log-redact-yaml-quote/requirements.md#FR-03
最近确认：60f8d9e41e2ccb9446325a0679f0fb6a5ec2c31e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-18-audit-log-redact-yaml-quote:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/dsh-settings.test.ts「writeDshHome（per-session 路由写盘）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-18-audit-log-redact-yaml-quote
  status: active

## FR-docs-016 待决策 pill 与变更文件 pill 渲染在同一悬浮组内竖向排列，各自空数据不渲染的显隐契约不变
变更：2026-10-16-session-pill-dock-drag
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-session-pill-dock-drag/requirements.md#FR-01
最近确认：f0ba3f3fb30b7b0743ad3265a86578205a46ed43

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-pill-dock-drag:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「无关联变更（data 空数组/未就绪）不渲染入口」 | frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx「三类全空（pending 空 + 历史空/未加载）不渲染入口（FR-01）」 | frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「竖排停靠组：children 渲染成组（flex-col 右对齐），portal 挂 body」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-pill-dock-drag
  status: active

## FR-docs-017 两 pill 的下拉均为点击展开（hover 不触发）、再点或点外部收起
变更：2026-10-16-session-pill-dock-drag
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-session-pill-dock-drag/requirements.md#FR-02
最近确认：f0ba3f3fb30b7b0743ad3265a86578205a46ed43

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-pill-dock-drag:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「点击弹下拉（hover 不再触发）：进行中置顶（轻量徽标+阶段），已归档默认折叠」 | frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx「点击弹下拉（hover 不再触发）：待决策置顶（提问/Plan 徽标），已答历史默认折叠（FR-02）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-pill-dock-drag
  status: active

## FR-docs-018 悬浮组按住可在 viewport 范围内拖动，松手自动吸附较近的左右边界，纵向钳制在窗口内，位置 localStorage 持久化
变更：2026-10-16-session-pill-dock-drag
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-session-pill-dock-drag/requirements.md#FR-03
最近确认：f0ba3f3fb30b7b0743ad3265a86578205a46ed43

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-pill-dock-drag:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「拖到右半屏松手吸附右缘」 | frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「拖拽越界钳回窗内：y 不出上下边」 | frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「持久化位置恢复；损坏存档静默回落默认右下」 | frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「按住拖动超过阈值：跟手且钳制窗内，松手吸附较近左缘并持久化」 | frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「视口缩放：钳回窗内并保持吸附侧」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-pill-dock-drag
  status: active

## FR-docs-019 位移小于阈值视为点击不触发拖拽，拖拽结束后的残余 click 被吞掉，pill 按钮点击行为不受影响
变更：2026-10-16-session-pill-dock-drag
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-session-pill-dock-drag/requirements.md#FR-04
最近确认：f0ba3f3fb30b7b0743ad3265a86578205a46ed43

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-pill-dock-drag:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「位移小于阈值不算拖拽：click 放行给 pill 按钮」 | frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「拖拽结束后的残余 click 被吞；时间窗外恢复点击」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-pill-dock-drag
  status: active

## FR-docs-020 相关组件测试与 tsc 通过
变更：2026-10-16-session-pill-dock-drag
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-session-pill-dock-drag/requirements.md#FR-05
最近确认：f0ba3f3fb30b7b0743ad3265a86578205a46ed43

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-pill-dock-drag:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx | frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-pill-dock-drag
  status: active

## FR-docs-021 preview-merge 归并层对「started_at 为空 + 无 error_code + previewTurnStatusOf 映射终态完成/中止族」的大纲条目不再合成预览卡：命中已加载轮/孤儿配置行时原引用透传并盖 seq，未命中时不生成条目
变更：2026-10-19-preview-card-empty-turn-fix
状态：active
摘要：纯切换轮命中孤儿配置行（用户实测主路径）；纯切换轮未命中（深历史静默轮）
全文：.sillyspec/changes/archive/2026-10-19-preview-card-empty-turn-fix/requirements.md#FR-01
最近确认：99f758c6f7d64b6bc36a05a1aead5a30a42389aa

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-preview-card-empty-turn-fix:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts「纯切换轮命中孤儿配置行原引用透传并盖 seq，不出预览卡」 | frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts「纯切换轮未命中不生成条目」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-preview-card-empty-turn-fix
  status: active

## FR-docs-022 失败族（status failed/error 或 error_code 非空）与活跃族（running/pending 等）大纲条目仍照旧合成预览卡，展开/跳转/预取链路行为不变
变更：2026-10-19-preview-card-empty-turn-fix
状态：active
摘要：三类轮不受影响
全文：.sillyspec/changes/archive/2026-10-19-preview-card-empty-turn-fix/requirements.md#FR-02
最近确认：99f758c6f7d64b6bc36a05a1aead5a30a42389aa

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-preview-card-empty-turn-fix:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts「error_code 轮（started_at 空）仍出预览卡」 | frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts「running 轮（started_at 空）仍出预览卡」 | frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts「started_at 有值零摘要轮（群聊空轮）仍出预览卡」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-preview-card-empty-turn-fix
  status: active

## FR-docs-023 handleExpandPreview 对 empty 结果给出 notify 轻提示（该轮无对话内容），不再纯静默；failed 提示语义不变
变更：2026-10-19-preview-card-empty-turn-fix
状态：active
摘要：零正文轮点击有反馈
全文：.sillyspec/changes/archive/2026-10-19-preview-card-empty-turn-fix/requirements.md#FR-03
最近确认：99f758c6f7d64b6bc36a05a1aead5a30a42389aa

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-preview-card-empty-turn-fix:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx「真零正文轮点击出轻提示且幂等语义不变」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-preview-card-empty-turn-fix
  status: active

## FR-docs-024 新增单测覆盖无内容终态条目透传与跳过两分支、error_code 轮仍出卡、running 轮仍出卡
变更：2026-10-19-preview-card-empty-turn-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-19-preview-card-empty-turn-fix/requirements.md#FR-04
最近确认：99f758c6f7d64b6bc36a05a1aead5a30a42389aa

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-preview-card-empty-turn-fix:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts「无内容终态轮」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-preview-card-empty-turn-fix
  status: active

## FR-docs-025 既有 preview-merge / turn-preview-card / session-preview-integration 相关测试面全部通过，零回归
变更：2026-10-19-preview-card-empty-turn-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-19-preview-card-empty-turn-fix/requirements.md#FR-05
最近确认：99f758c6f7d64b6bc36a05a1aead5a30a42389aa

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-preview-card-empty-turn-fix:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx | frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx | frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-preview-card-empty-turn-fix
  status: active

## FR-docs-026 导航刻度点击无内容终态轮直接定位既有配置行（不发请求不报错）；三处固定文案 toast 改 warning 通道不再显示为「操作失败」
变更：2026-10-19-preview-card-empty-turn-fix
状态：active
摘要：导航点击静默切换轮；真缺失日志轮（started_at 有值但查回 0 条）
全文：.sillyspec/changes/archive/2026-10-19-preview-card-empty-turn-fix/requirements.md#FR-06
最近确认：99f758c6f7d64b6bc36a05a1aead5a30a42389aa

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-preview-card-empty-turn-fix:flow:测试绑定FR-06
  tests: frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx「真缺失日志轮导航点击报原文 warning 而非操作失败」 | frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx「纯切换轮导航刻度点击直接定位配置行不报错不发请求」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-preview-card-empty-turn-fix
  status: active

## FR-docs-027 sillyspec-gotchas.md 新增 4 条目（格式对齐既有条目：## 标题+机理+规避/做法+来源标注时点与 CLI 版本）
变更：2026-10-20-sillyspec-gotchas-session
状态：active
摘要：格式与内容对齐
全文：.sillyspec/changes/archive/2026-10-20-sillyspec-gotchas-session/requirements.md#FR-01
最近确认：06e0a0cc5908aa37fbbc2e79ab0b741fb1b6381a

## FR-docs-028 INDEX.md SillySpec 坑段同步 4 行关键词索引（锚点与条目标题一致）
变更：2026-10-20-sillyspec-gotchas-session
状态：active
摘要：索引可检索
全文：.sillyspec/changes/archive/2026-10-20-sillyspec-gotchas-session/requirements.md#FR-02
最近确认：06e0a0cc5908aa37fbbc2e79ab0b741fb1b6381a

## FR-docs-029 sillyspec knowledge validate 0 错 0 警
变更：2026-10-20-sillyspec-gotchas-session
状态：active
摘要：知识库完整性
全文：.sillyspec/changes/archive/2026-10-20-sillyspec-gotchas-session/requirements.md#FR-03
最近确认：06e0a0cc5908aa37fbbc2e79ab0b741fb1b6381a

## FR-docs-030 失败轮（error_code=interactive_interrupted 且 error_detail 非空）在会话页面渲染错误卡，轮状态显示为失败而非已中止
变更：2026-10-20-session-error-visibility
状态：active
摘要：快照回看（刷新页面）；实时 SSE 终态回补
全文：.sillyspec/changes/archive/2026-10-20-session-error-visibility/requirements.md#FR-01
最近确认：6f2fe0baf5d63d5a078e96a39670a5543a7c9bfe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-session-error-visibility:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/page-helpers-error-visibility.test.ts「实时终态条件扩展由快照升级同源判定覆盖（enrichDisplayTurns 与终态回补共用 buildErrorLogItem，快照用例即契约锚）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-error-visibility
  status: active

## FR-docs-031 错误卡默认直接可见原始错误文本首行（如 codex exited code=1），无需点击查看详情
变更：2026-10-20-session-error-visibility
状态：active
摘要：unknown 兜底错误
全文：.sillyspec/changes/archive/2026-10-20-session-error-visibility/requirements.md#FR-02
最近确认：6f2fe0baf5d63d5a078e96a39670a5543a7c9bfe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-session-error-visibility:flow:测试绑定FR-02
  tests: frontend/src/components/agent-log/__tests__/run-error-item.test.tsx「raw 首行摘要默认可见无需点击」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-error-visibility
  status: active

## FR-docs-032 真打断（error_detail 为空的 interactive_interrupted）仍显示已中止，不出现错误卡
变更：2026-10-20-session-error-visibility
状态：active
摘要：用户手动打断
全文：.sillyspec/changes/archive/2026-10-20-session-error-visibility/requirements.md#FR-03
最近确认：6f2fe0baf5d63d5a078e96a39670a5543a7c9bfe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-session-error-visibility:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/page-helpers-error-visibility.test.ts「真打断 error_detail 为空保持已中止零回归」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-error-visibility
  status: active

## FR-docs-033 相关前端测试更新并通过
变更：2026-10-20-session-error-visibility
状态：active
摘要：测试运行
全文：.sillyspec/changes/archive/2026-10-20-session-error-visibility/requirements.md#FR-04
最近确认：6f2fe0baf5d63d5a078e96a39670a5543a7c9bfe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-session-error-visibility:flow:测试绑定FR-04
  tests: frontend/src/components/agent-log/__tests__/run-error-item.test.tsx「长 raw 首行截断展示」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-error-visibility
  status: active

## FR-docs-034 daemon 对有 api_key 的 anthropic 直连形态 codex 供应商，写出的 config.toml [model_providers.sillyhub] 段含 requires_openai_auth = true；端到端：平台 codex 会话选直连供应商真实对话跑通（不再 stream disconnected）
变更：2026-10-20-codex-requires-openai-auth
状态：active
摘要：有 key 直连供应商
全文：.sillyspec/changes/archive/2026-10-20-codex-requires-openai-auth/requirements.md#FR-01
最近确认：409315def4b848f950771392b7be388068c7304f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-codex-requires-openai-auth:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/codex-settings.test.ts「requires_openai_auth：anthropic 形态有 key 时写出该行（wire_api 行后）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-codex-requires-openai-auth
  status: active

## FR-docs-035 keyless 供应商（api_key 缺省）行为不变：不写该键，产物与现状逐字一致（spike A3a keyless 语义零回归）
变更：2026-10-20-codex-requires-openai-auth
状态：active
摘要：keyless 直连供应商；openai_chat 形态零回归
全文：.sillyspec/changes/archive/2026-10-20-codex-requires-openai-auth/requirements.md#FR-02
最近确认：409315def4b848f950771392b7be388068c7304f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-codex-requires-openai-auth:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/codex-settings.test.ts「key=daemonApiKey / base_url=litellm_base_url / model=litellm_model_name」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-codex-requires-openai-auth
  status: active

## FR-docs-036 智谱 GLM / OpenCode Go 两个预设声明 codex 专用端点覆盖（base_url+默认模型，模型均为实测可用）
变更：2026-10-20-preset-engine-endpoint
状态：active
摘要：预设常量
全文：.sillyspec/changes/archive/2026-10-20-preset-engine-endpoint/requirements.md#FR-01
最近确认：bc88187dcee54e94289c2fcc742a802ffef45c00

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-preset-engine-endpoint:flow:测试绑定FR-01
  tests: frontend/src/components/llm-providers/__tests__/llmProviderPresets.test.ts「zhipu_glm/opencode_go 声明 codex 覆盖且端点/模型正确；其余预设无覆盖」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-preset-engine-endpoint
  status: active

## FR-docs-037 表单勾选 Codex 时：选中带覆盖的预设 → base_url/默认模型联动切到 codex 端点，并自动取消 Claude 勾选（一条凭证一个端点的平台约束），notice 提示为 Claude 另建一条；取消 Codex → 回 claude 形态
变更：2026-10-20-preset-engine-endpoint
状态：active
摘要：勾 Codex 联动；恢复 claude 形态（经对称勾回分支）
全文：.sillyspec/changes/archive/2026-10-20-preset-engine-endpoint/requirements.md#FR-02
最近确认：bc88187dcee54e94289c2fcc742a802ffef45c00

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-preset-engine-endpoint:flow:测试绑定FR-02
  tests: frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx「勾选 Codex 联动切换 codex 端点并取消 Claude 勾选；取消 Codex 恢复 claude 形态」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-preset-engine-endpoint
  status: active

## FR-docs-038 未选中预设或预设无覆盖时勾选行为与现状零回归（自定义/其它预设不受影响）
变更：2026-10-20-preset-engine-endpoint
状态：active
摘要：自定义零回归
全文：.sillyspec/changes/archive/2026-10-20-preset-engine-endpoint/requirements.md#FR-03
最近确认：bc88187dcee54e94289c2fcc742a802ffef45c00

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-preset-engine-endpoint:flow:测试绑定FR-03
  tests: frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx「自定义表单勾选 Codex 零联动（base_url/模型不变）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-preset-engine-endpoint
  status: active

## FR-docs-039 弹窗观感对齐已确认原型：品牌图标头+副标题、页脚左侧红线注脚（单行省略）、品牌竖条小节头
变更：2026-10-22-agent-profile-modal-restyle
状态：active
摘要：打开新建弹窗
全文：.sillyspec/changes/archive/2026-10-22-agent-profile-modal-restyle/requirements.md#FR-01
最近确认：2fef11f807db97a27cdbd0f4fb036d7030bf821c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-agent-profile-modal-restyle:flow:测试绑定FR-01
  tests: test/frontend/src/components/__tests__/agent-profile-form.test.tsx「弹窗观感：品牌图标头副标题 + 页脚红线注脚 + 品牌竖条小节头」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-agent-profile-modal-restyle
  status: active

## FR-docs-040 技能区：全选复选（半选态、仅作用于当前筛选结果）+ 按名称与简介搜索 + 已选 N/总数计数 + 清空按钮 + 两行芯片网格（名称+一行简介，限高内滚）
变更：2026-10-22-agent-profile-modal-restyle
状态：active
摘要：全选与半选；搜索下全选仅作用于筛选结果
全文：.sillyspec/changes/archive/2026-10-22-agent-profile-modal-restyle/requirements.md#FR-02
最近确认：2fef11f807db97a27cdbd0f4fb036d7030bf821c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-agent-profile-modal-restyle:flow:测试绑定FR-02
  tests: test/frontend/src/components/__tests__/agent-profile-form.test.tsx「技能全选/半选/清空/计数」 | test/frontend/src/components/__tests__/agent-profile-form.test.tsx「搜索按名称与简介命中且全选仅作用于筛选结果」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-agent-profile-modal-restyle
  status: active

## FR-docs-041 技能简介来自真实数据（manifest SKILL.md frontmatter description / 自定义技能 description），非硬编码
变更：2026-10-22-agent-profile-modal-restyle
状态：active
摘要：并集与简介渲染
全文：.sillyspec/changes/archive/2026-10-22-agent-profile-modal-restyle/requirements.md#FR-03
最近确认：2fef11f807db97a27cdbd0f4fb036d7030bf821c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-agent-profile-modal-restyle:flow:测试绑定FR-03
  tests: test/frontend/src/components/__tests__/agent-profile-form.test.tsx「技能简介来自数据源并集渲染（自定义优先）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-agent-profile-modal-restyle
  status: active

## FR-docs-042 技能区滚动条三主题下细样式半透明，暗夜不刺眼（作用域限本弹窗技能区）
变更：2026-10-22-agent-profile-modal-restyle
状态：active
摘要：暗夜主题滚动
全文：.sillyspec/changes/archive/2026-10-22-agent-profile-modal-restyle/requirements.md#FR-04
最近确认：2fef11f807db97a27cdbd0f4fb036d7030bf821c

## FR-docs-043 无硬编码 hex，颜色走 brand/语义 token，三主题（blue/ai-native/dark）可切换
变更：2026-10-22-agent-profile-modal-restyle
状态：active
摘要：三主题切换
全文：.sillyspec/changes/archive/2026-10-22-agent-profile-modal-restyle/requirements.md#FR-05
最近确认：2fef11f807db97a27cdbd0f4fb036d7030bf821c

## FR-docs-044 既有行为回归不变：可见范围=工作区时出现归属工作区选择器、右栏预览实时联动、名称必填、红线文案不变
变更：2026-10-22-agent-profile-modal-restyle
状态：active
摘要：既有用例回归
全文：.sillyspec/changes/archive/2026-10-22-agent-profile-modal-restyle/requirements.md#FR-06
最近确认：2fef11f807db97a27cdbd0f4fb036d7030bf821c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-agent-profile-modal-restyle:flow:测试绑定FR-06
  tests: test/frontend/src/components/__tests__/agent-profile-form.test.tsx「既有用例回归（body 组装/归属选择器/预览联动/提交路径）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-agent-profile-modal-restyle
  status: active

## FR-docs-045 useCreateAgentProfile/useUpdateAgentProfile 成功后必须同时 invalidate workspaceList(wid) 与 mineList 两桶（全局页编辑/新建保存后卡片墙立即刷新）
变更：2026-10-22-agent-profile-edit-refresh
状态：active
摘要：全局页编辑保存；全局页新建保存
全文：.sillyspec/changes/archive/2026-10-22-agent-profile-edit-refresh/requirements.md#FR-01
最近确认：302ebb786c739b33837b2fda22f89141637412bb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-agent-profile-edit-refresh:flow:测试绑定FR-01
  tests: test/frontend/src/lib/__tests__/agent-profiles.test.tsx「create/update 成功后失效 workspaceList 与 mineList 两桶」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-agent-profile-edit-refresh
  status: active

## FR-docs-046 工作区内页（workspaceList 桶）刷新行为不回归
变更：2026-10-22-agent-profile-edit-refresh
状态：active
摘要：工作区内页编辑
全文：.sillyspec/changes/archive/2026-10-22-agent-profile-edit-refresh/requirements.md#FR-02
最近确认：302ebb786c739b33837b2fda22f89141637412bb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-agent-profile-edit-refresh:flow:测试绑定FR-02
  tests: test/frontend/src/lib/__tests__/agent-profiles.test.tsx「既有 workspaceList 失效不回归（同一用例内并断言）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-agent-profile-edit-refresh
  status: active

## FR-docs-047 lib 层新增 hook 失效行为单测（断言两桶 key 均被失效）
变更：2026-10-22-agent-profile-edit-refresh
状态：active
摘要：单测覆盖
全文：.sillyspec/changes/archive/2026-10-22-agent-profile-edit-refresh/requirements.md#FR-03
最近确认：302ebb786c739b33837b2fda22f89141637412bb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-agent-profile-edit-refresh:flow:测试绑定FR-03
  tests: test/frontend/src/lib/__tests__/agent-profiles.test.tsx「mutation 失败不触发失效」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-agent-profile-edit-refresh
  status: active

## FR-docs-048 docs/sillyspec/finished/ 新增坑11 文档，含现象/根因/修复/现场清理/验证要点五段，与坑9/坑10 体例一致并互链
变更：2026-10-23-rename-ghost-pit-doc
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-rename-ghost-pit-doc/requirements.md#FR-01
最近确认：e24e1eb9da5f05b4950b595c8f33640034e3bf4d

## FR-docs-049 历史加载在飞期间，时间线区域显示轮次骨架屏（动态加载指示），不再显示静态空态文案或空白
变更：2026-10-23-session-first-load-ux
状态：active
摘要：进入大会话，历史在拉；大纲先到（预览卡先渲染）
全文：.sillyspec/changes/archive/2026-10-23-session-first-load-ux/requirements.md#FR-01
最近确认：58cebf9df158804564dd87110c7673ef898a3703

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-session-first-load-ux:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/turn-timeline-history-loading.test.tsx「历史在飞时渲染轮次骨架屏替代空态文案；turns 非空即退场」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-session-first-load-ux
  status: active

## FR-docs-050 首屏轮次内容在底窗日志（400行）到达后立即渲染，不等 buildInitialWindow 补拉链完成；补拉结果到达后增量合并进时间线，翻页游标与「加载更早」语义不回退
变更：2026-10-23-session-first-load-ux
状态：active
摘要：大会话进入，底窗先见；补拉与 SSE 并发；补拉在飞时用户触顶
全文：.sillyspec/changes/archive/2026-10-23-session-first-load-ux/requirements.md#FR-02
最近确认：58cebf9df158804564dd87110c7673ef898a3703

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-session-first-load-ux:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/session-panel/__tests__/session-first-load-staged.test.tsx「底窗到达即渲染最近轮；补拉完成后增量 prepend；补拉在飞挂起加载更早」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-session-first-load-ux
  status: active

## FR-docs-051 真无轮次的空会话仍显示原空态文案，不误显骨架屏
变更：2026-10-23-session-first-load-ux
状态：active
摘要：新建空会话
全文：.sillyspec/changes/archive/2026-10-23-session-first-load-ux/requirements.md#FR-03
最近确认：58cebf9df158804564dd87110c7673ef898a3703

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-session-first-load-ux:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/turn-timeline-history-loading.test.tsx「历史拉取终态空会话保持原空态文案」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-session-first-load-ux
  status: active

## FR-docs-052 既有测试不回归，新增加载态与分阶段渲染行为有测试覆盖
变更：2026-10-23-session-first-load-ux
状态：active
摘要：回归护栏
全文：.sillyspec/changes/archive/2026-10-23-session-first-load-ux/requirements.md#FR-04
最近确认：58cebf9df158804564dd87110c7673ef898a3703

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-session-first-load-ux:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/session-panel/__tests__/session-first-load-staged.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-session-first-load-ux
  status: active
