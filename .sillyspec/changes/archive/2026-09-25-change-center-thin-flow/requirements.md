---
author: qinyi
created_at: 2026-09-24 22:54:42
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 在变更中心创建/查看/派发变更的用户 |
| thin 派发 agent | 变更中心按 STAGE_AGENT_CONFIG["thin"] 派发的 daemon 会话 agent |
| sillyspec CLI | 外部系统（≥3.30.0），flow start/flow done 协议执行方与 progress/事件推送方 |

## 功能需求

### FR-01: THIN 辅助阶段与派发配置
Given StageEnum 现有 QUICK 辅助阶段先例（backend/app/modules/change/model.py:65-72）
When 变更中心为 quick 类型新变更派发 agent
Then StageEnum 含 THIN="thin"（进 spec_auxiliary_stages，不进 TRANSITIONS/STAGE_ORDER，跑完即终态），STAGE_AGENT_CONFIG 含 "thin" 条目（prompt_template=thin.md、requires_worktree=False、read_only=False），manual dispatch 泛化路径零改动可用

### FR-02: thin 派发 prompt 契约
Given thin 派发 agent 需执行 2 调用协议
When agent 收到派发 prompt
Then prompt 指示：flow start 带 --input 多行文本（动机行 + 独立节头行「成功标准：」+ 每行一条 `- <标准>`——单行内联会被清晰度门拒）；干活期间填 design 四节 AGENT 槽与 requirements 测试绑定槽；flow done 收口，中间态 exit 1 断点续、实测失败 fail-closed；platform_args 沿用现有形态（3.30.0 已消费 --spec-root）

### FR-03: 写入分流 quick→thin
Given change_writer 分类器输出 change_type="quick"
When service.py/proxy.py 写入新变更
Then initial_stage="thin"（原 "quick"）；change_type 标签保留 "quick" 不改；stages JSON 初值含 thin 组

### FR-04: flow 命令族会话绑定
Given thin 派发 agent 在会话内执行 `sillyspec flow start|done|amend-draft --change <名>`
When daemon run_sync submit_commit 解析 bash 命令
Then extract_spec_bindings 产出 SpecCommandBinding(kind="change", change_key=<名>)，会话正确写入 change_session_links；既有 run quick 跳过规则保留

### FR-05: 阶段回洗双守卫
Given thin 变更在 sillyspec.db 停留 current_stage='scan'/status='active'，归档翻 status='archived'
When ① daemon run_sync 回调 sync_stage_status（dispatch.py:1784 一带）或 ② CLI progress 上行 _sync_change_stage_status（platform_sync/service.py:997 一带）
Then 平台 change.current_stage=='thin' 且 DB 行非 archived 时：不回写 current_stage、不写 stages['scan'] JSON 块（时间戳类更新照常）；DB 行 archived 时放行既有归档翻转链；非 thin 变更两路径行为逐字不变

### FR-06: 前端 thin 视觉与交互（显示名「轻量变更」，D-002@v1）
Given 前端七处硬编码触点（徽章映射/STATUS_BADGE/STAGE_OPTIONS 双副本/说明卡/概览卡两处旁路判断/移动端审批卡/时间线组标签）
When thin 变更出现在列表/详情/概览/移动端
Then 徽章「◈ 轻量变更」品牌紫阶（quick 改「快速任务（存量）」琥珀）；筛选下拉含「轻量变更」（桌面+移动两份副本）；详情页 thin 两段式说明卡（桌面+移动同款，含命令与断点续提示）；概览卡 thin 走旁路徽标非全灰管线；无任何裸显英文 "thin"

### FR-07: quick 存量软退役标注
Given quick 为存量过渡通道（CLI 横幅语义）
When 用户查看 quicklog 面板/quick 说明卡/统计卡/流程指引文档
Then quicklog tab 计数标「存量 · N」、空态文案换退役指引（桌面 quicklog-table:346 + 移动 :873 两处必改）；quick 说明卡标「已退役·存量收尾」；CLAUDE.md 规则 4 改指轻量变更、规则 19 标存量；.zcode/skills/sillyspec-quick 加退役横幅与用法段；模块文档/changelog 同步；存量 quick 变更收尾链路行为不变

### FR-08: 纵深防御与对账
Given 上游 3.30.0 已有变更名白名单但平台入口无校验；watcher 事件按 change_name 字符串归属
When thin 变更派发/CLI 侧自建 thin 目录 reparse/watcher 事件上行
Then 派发入口对 thin 变更校验 change_key（`^[A-Za-z0-9_.\-]+$`，拒 `..`/`default`/`quick-<hex8>`）；parser _infer_current_stage 认 flow-state.yaml→"thin"；测试对账事件归属两前提（change_name 与平台 change_key 逐字一致、workspace 归属一致）

## 非功能需求
- 兼容性：存量 quick 全链（QUICK 派发/quicklog 读写/bind_quick_id/蒸馏源）一行不动；主线五阶段与 quick 的 sync 行为逐字不变；无表结构/OpenAPI 变更（零迁移、无需 gen:types）；回退路径=change_writer 分流一行改回
- 环境依赖：daemon 侧 sillyspec ≥3.30.0（verify 步骤核验 sillyspec --version）
- 平台兼容：实现兼容 Windows/Linux/macOS（CLAUDE.md 规则 13）
- 测试纪律：仅跑本变更相关聚焦测试（CLAUDE.md 规则 0），全量留 CI

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-03, FR-04, FR-05, FR-06 | THIN 新辅助阶段 + 同列展示 + 内部差异化（quick 存量保留） |
| D-002@v1 | FR-06, FR-07, FR-02 | 显示名「轻量变更」（技术值 thin），全部文案位统一 |
