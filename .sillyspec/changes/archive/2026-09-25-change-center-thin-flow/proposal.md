---
author: qinyi
created_at: 2026-09-24 22:54:42
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机
SillySpec CLI 已完成 quick 退役与轻量变更（thin）转正（flow.mode 缺省 thin，3.30.0；上游平台参数面前置修复已发布安装）。平台侧大部分新变更将走 thin 的 2 调用协议（flow start → 干活 → flow done），而变更中心当前与该流程全面脱节——三个硬缺口（会话绑定断链 / 阶段回洗两条路径 / 派发 prompt 契约）经三子代理核对实证到行号，不修则 thin 派发不可用或状态错乱。

## 关键问题
1. **会话绑定断链**：stage 派发会话的变更绑定唯一依靠 `sillyspec run` 命令解析通道（backend/app/modules/change/binding.py:72-79），`sillyspec flow start --change X` 匹配不到——thin 派发会话在变更详情不可见。
2. **阶段回洗**：thin 变更在 sillyspec.db 全程停 `scan/active`（CLI 红线），daemon run_sync 回调（backend/app/modules/change/dispatch.py:1784）与 CLI progress 上行（backend/app/modules/platform_sync/service.py:997）两条路径都会把平台阶段从 thin 洗回 scan 并污染 stages JSON。
3. **quick 退役不同步**：平台仍在新建 quick 阶段变更、三处文案指路已退役命令，与上游「存量收尾、停止新增」语义相悖。

## 变更范围
- 后端：StageEnum 加 THIN 辅助阶段 + STAGE_AGENT_CONFIG + thin.md 派发 prompt；change_writer/proxy 分流 quick→thin；binding 认 flow 命令族；双守卫（dispatch.py + platform_sync/service.py，含 stages JSON 跳过与 archived 放行）；parser 认 flow-state.yaml；派发入口 change_key 白名单。
- 前端：thin 徽章/标签/筛选项/说明卡（桌面+移动，显示名「轻量变更」D-002@v1）；quick 存量标注与退役文案修正（三处）。
- 配置文档：CLAUDE.md 规则 4/19、.zcode/skills/sillyspec-quick 退役横幅、模块文档/changelog 四件、docs/sillyspec 工具坑留档。
- 测试：thin 阶段族/双守卫/绑定/白名单/parser/事件归属对账。

## 不在范围内（显式清单）
- 不做 thin 进行中状态细粒度展示（flow-state.yaml 六子步/tier 升厚标记）——P2 另立变更
- 不动 quicklog 全链读侧、bind_quick_id/ql- 校验、quicklog 推送端点、daemon guard.json、蒸馏源 "quick"（存量通道全保留）
- 不做表结构/OpenAPI 契约变更（current_stage 全链自由字符串，零迁移、无需 gen:types）
- 不改 watcher 事件通道（v2 语义 + 在途 v3 原地演进互不冲突）、不改 scope-audit 模式面、不动 quick-chat
- 不做 change_type 标签改名（与阶段解耦，D-001@v1 配套裁决）

## 成功标准（可验证）
- quick 类型新变更分流至 thin 阶段，manual dispatch 派发 thin agent，prompt 含过门格式与断点续语义
- thin 派发会话经 flow 命令解析正确写入 change_session_links（变更详情可见）
- thin 变更在 CLI progress 上行与 run 完成回调两路径下阶段恒显「轻量变更」，stages JSON 无幽灵 scan 组；flow done 归档后正确翻归档态
- 存量 quick 变更行为逐字不变（quick 派发/收尾链路回归通过）
- 前端七触点全落位：无裸显 "thin"、无全灰管线、移动端有说明卡；三处退役文案不再指路 sillyspec quick
- 类型面/API 契约零变化；聚焦测试全绿（不跑全量，规则 0）
