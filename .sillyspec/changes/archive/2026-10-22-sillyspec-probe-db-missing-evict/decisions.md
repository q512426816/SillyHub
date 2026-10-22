---
author: flow-machine-draft
created_at: 2026-10-22T16:39:28.747Z
---
# 决策记录（Decisions）— 2026-10-22-sillyspec-probe-db-missing-evict

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：把「暂时没 init 但马上要 init」的项目误淘汰——项目 init 后 workspace 重新 claim 会重新注册根，且淘汰阈值 3 次（默认采集间隔 + backoff）留了观察窗；误淘汰代价仅是面板暂缺该工作区数据，重新 claim 即恢复。 次要风险：CLI 未来在 db_missing 时改掉 stdout envelope 契约 → 解析不到 codes 回退既有 nonzero_exit 记账（降级不劣化）。 放弃方案 A：restore 时向平台批量核对工作区存活状态——boot 增加平台往返与失败面，且运行期删除的工作区仍会残留到下次重启，不如运行期连败淘汰直接。 放弃方案 B：CLI 侧 db_missing 改 exit 0——改机器接口语义，影响其他消费方，违反「CLI 零改动」。
