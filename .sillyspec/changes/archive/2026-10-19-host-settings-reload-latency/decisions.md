---
author: flow-machine-draft
created_at: 2026-10-19T02:55:24.644Z
---
# 决策记录（Decisions）— 2026-10-19-host-settings-reload-latency

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- **最大风险**：空转读文件频率 ×3（每秒读 2-6KB + JSON 解析）。量级可忽略（单核微秒级）， 定时器仍 unref；接受。 - **风险 2**：重载风暴更密（用户连续快速换档时，每 2 秒可触发一波）。上一变更已论证 per-session 串行 + 覆盖写幂等承载得住；去抖两拍本身就是节流。 - **死路（放弃）**：去抖单拍化（见做法概述）；fs.watch（同上变更死路 2）。 - **遗留**：UI 可感知提示（切换时平台界面出 notice）需 daemon→backend→frontend 三端契约 （新端点 + SSE 帧 + 类型再生成），本变更明确不做，留待单独立项。
