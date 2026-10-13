---
author: flow-machine-draft
created_at: 2026-10-13T10:53:07.566Z
---
# 决策记录（Decisions）— 2026-10-13-daemon-turn-anchor-snapshot

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：大仓上每轮 git add -A 的 IO 成本——mitigated by 复制现场 index（stat 缓存命中）+ tree sha 去重（零变化轮零落盘）；廉价门（本轮工具事件触过文件才打锚，评审 Gap4）留作后续切片，当前以去重+缓存先扛。次风险：首轮 diff 退 HEAD 树会漏掉"轮内已 commit"的归因（内容变化仍在 tree-to-tree 链上，仅首轮 files 口径偏小）——最小闭环已知边界，记档不扩。既有测试影响：onResult 接线在既有 session-manager 测试中对假 cwd（C:\work 等不存在路径）静默 null，实测 tests/interactive/ 1115 用例两轮全绿（首跑 1 例 pi-rpc 60ms 握手抖动，复跑+单跑均绿，与本改动无关）。 放弃的方案：①`git stash create` 打锚——不含 untracked（评审 Gap1 定性为雷，直接否决）；②每轮 commit 到 side ref——写引用有状态、并发清理复杂，write-tree 无引用纯内容寻址更干净；③`git status --porcelain` 轮询比对——无行级统计且 rename/untracked 口径碎；④锚存 DB（backend 落库）——本切片刻意 daemon-local（零 API 面），DB 化留给下一切片连同前端展示一起做。
