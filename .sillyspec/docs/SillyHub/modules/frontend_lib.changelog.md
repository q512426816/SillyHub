---
author: qinyi
created_at: 2026-10-16 16:40:00
---

# 模块变更索引（changelog sidecar）

## 2026-10-16 — token-refresh 状态码分流（变更 2026-10-16-fix-auth-random-logout task-03）
- `doRefresh` 按状态码分流：2xx 返回新对；401/403/其余 4xx 返回 null（明确失效，api.ts 401 收口清会话跳登录）；**5xx/408/429 抛 ApiError（status 透传）不清会话**——修复「部署窗口/代理抖动 5xx 被当登录失效误踢」根因二（D-004@v1；对齐 ql-20260917-005 timeout 抛错通道先例）。
- `api.ts` 401 收口契约注释同步（代码逻辑不变：null 才 clear+redirect，抛错自然传播）。
- 用例：frontend/src/lib/__tests__/token-refresh.test.ts +3（503/504 抛错不清会话、408/429 归类、401 返 null）；13 处 `ensureFreshAccessToken` 调用点抛错容错审计通过（app-shell catch 兜底；其余与 timeout 先例同构）。
- 2026-10-16-change-files-sync-result | change 文件树「刷新」同步链路三层静默失败——后端 RPC 预算 3s 短于实测 6~13.5…
- 2026-10-16-change-title-condense-backfill | 变更中心标题提炼与存量回填
- 2026-10-17-audit-risk-followup | 24h 审计六连修收口：dsh/zcode 会话恢复白名单漏登记（daemon 重启静默丢记录）、r…
- 2026-10-18-change-list-type-filter | 变更列表加类型标签与类型筛选
- 2026-10-19-thinking-zh-translate | 思考内容离线翻译为中文展示
- 2026-10-19-change-assets-cross-repo-repos | 变更资产卡展示跨仓冻结面
- 2026-10-19-cross-repo-patch-slicing | 资产卡跨仓单文件 diff 切片
- 2026-10-21-provider-set-default-ui | 供应商页复活设为默认入口
- 2026-10-21-agent-profile-slim-default | 档案瘦身重定位为人格加技能清单并支持用户默认档案
- 2026-10-21-provider-default-ui-hint | 供应商未选态显示对齐用户默认供应商
- 2026-10-22-agent-profile-modal-restyle | 智能体档案弹窗重构与技能全选
- 2026-10-22-agent-profile-edit-refresh | 档案编辑后全局页列表自动刷新修复
- 2026-10-21-session-git-branch | 会话组件底部动态显示当前所在 git 分支
- 2026-10-22-daemon-snapshot-report-log | daemon 快照上报补收口日志
- 2026-10-22-fix-translate-pending | 生产 /api/translate/thinking 请求长时间 pending：容器未配置 TRA…
- 2026-10-22-session-trajectory-third-view | 把会话轨迹从「进度」视图内的第二层呈现开关上移为与「对话 / 进度」并列的第三个顶层视图，同时修复轨…
- 2026-10-22-turn-trigger-metadata-p2 | 轮触发溯源 Phase 2：定时消息接入与 metadata 戳驱动
- 2026-10-22-sillyspec-probe-db-missing-evict | 已删工作区探针自动淘汰与诊断增强
- 2026-10-20-session-awaiting-answer-status | 左侧会话状态补充等待回答问号
- 2026-10-22-conversation-live-marquee | 会话页「对话」tab 运行中时只有一行状态条，用户感知不到 agent 正在真实执行；希望在该轮末尾…
- 2026-10-22-agent-profiles-page-restyle | 智能体档案列表页重设计
- 2026-10-23-translate-budget-align | 修复翻译超时预算矛盾与缓存回填乱序
- 2026-10-22-session-composer-slim | 会话页面底部输入区信息过载：排队消息与纯文本展示露出附件引用 uuid 长串，中断自动续跑是常驻开关…
- 2026-10-23-semantic-color-scale-fix | 修复语义色阶未定义导致的隐形状态标记
- 2026-10-23-review-risk-fixes-2 | 审查遗留四处风险修复
- 2026-10-23-turn-file-diff-dialog | 轮次文件变更卡行点击弹窗显示变更内容（18字）
- 2026-10-23-marquee-motion-polish | 跑马灯动效与流光柔化
- 2026-10-23-session-network-context | 2026-10-23-session-network-context
- 2026-10-23-session-dialog-input-align | 会话浮窗输入即清与草稿语义对齐修复
- 2026-10-23-session-first-window-turn-align | 会话重新进入时首屏历史窗口按最近 400 条日志截断，单轮日志超过 400 条时窗口起点落在该轮中段…
- 2026-10-23-knowledge-scope-maintenance | 知识注入作用域维护面板
- 2026-10-25-trajectory-source-model | 2026-10-25-trajectory-source-model
- 2026-10-25-session-git-worktree-root | 会话 git 分支指示项感知 sillyspec 工作树
- 2026-10-26-turn-phase-orphan-fallback | 阶段事件竞态丢弃修复:turn_phase 事件按 run_id 精确匹配未命中时改为回退归属到当前…
- 2026-10-26-subagent-card-width-unify | 子代理卡片与工具卡限宽统一补漏
- 2026-10-26-subagent-task-meta-restore | 子代理任务元数据装配竞态修复
- 2026-10-27-task-wakeup-precision-fix | 修复任务唤醒判据与通知四处缺陷
- 2026-10-27-ghost-spec-binding-fix | 失败命令不再生成幽灵变更占位并过滤存量
- 2026-10-27-task-wakeup-inject-retry | 后台任务终态唤醒注入经后端中转单发无重试，撞后端短暂不可用窗（部署重建/502/504）即 inte…
- 2026-10-27-turn-phase-stall-honest-ui | 会话忙时用户消息在 backend 排队/派发链路滞留（生产实证 2026-10-27 会话 7ef…
- 2026-10-27-mobile-chat-visual-round4 | 用户四轮反馈：子代理卡/进度视图过程块(运行命令等)仍不满宽(8 处 calc(100%-120px…
- 2026-10-27-turn-phase-observability-monotonic | 生产实证（2026-10-27 会话 7eff99e1，run 4f2e2cdd）：first_ev…
- 2026-10-27-sessions-total-and-status-filter | 会话列表数据统计修正：用户手机/PC 会话页总数被前端拉取上限截断在 500（实际 515），状态筛…
- 2026-10-27-knowledge-hits-flush-button | 知识遥测断流根因：sillyspec CLI 2026-10-18 把遥测文件迁至 .runtime…
- 2026-10-28-knowledge-hits-cli-direct | CLI 直报主通道的接收侧（用户拍板方案收尾）：CLI 侧只持有 shpsync_ 平台令牌（wor…
- 2026-10-28-change-detail-sessions-source-fix | 变更详情会话区数据源错挂与附件标题修复：概览「会话」区实际取工作区全量最近会话而非该变更关联会话，用…
- 2026-10-28-session-config-default-provider-fix | 会话配置条默认供应商显示与模型联动缺陷：pi 等引擎会话显示了不匹配引擎的默认供应商名（兜底查找未按…
