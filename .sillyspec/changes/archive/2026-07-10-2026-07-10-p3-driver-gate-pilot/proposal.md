---
author: qinyi
created_at: 2026-07-10T14:25:00+08:00
---

# 提案书（Proposal）

## 动机
agent 自述完成（声明态）平台就信，没有客观核验。把 agent 驾驭工程从"信任自述"升级为"平台客观核验通过才推进"——这是 SillyHub 作为 driver 的核心。

## 关键问题（现有方案不够）
1. **verify 靠 `read_verify_result` 读 verify-result.md，文件缺失默认 "passed"**（`dispatch.py:775`）——agent 不写 verify-result 也算过
2. **`sync_stage_status` 读 agent 自己 `--done` 写的 sillyspec.db**（声明态）——agent 说完成平台就信
3. 没有机制跑真实测试核验 agent 产出（sillyspec gate/derive 机器接口已就绪但未被消费）

## 变更范围
P3 verify stage 试点：在 agent 完成→推进间插入 `sillyspec gate verify` 客观核验（backend 触发 + daemon 执行 + 后台异步），替代声明态。三态决策：exit 0 推进 / exit 1 打回（3 次上限）/ exit 2 卡住 fail-loud。

## 不在范围内
- execute / brainstorm / plan 的 gate（P4 / 留后）
- host_* 代码实体重命名（HostFsDelegate→DaemonFsDelegate 等，随 host 移除独立做）
- 独立 worker / 消息队列（用 _fire_background_task + reconcile 够）
- daemon 主动跑 gate（N×27s 死穴）/ backend 容器直接跑（够不到源代码）—— 已否

## 成功标准（可验证）
- verify stage 跑 `gate verify`，实测通过才推进（agent 写假 PASS 不再过）
- gate exit 1 打回 + errors 反馈，`gate_retry_count` 3 次上限后 exit 2 报警
- gate 异常 / sillyspec 未发版 → exit 2 阻断 fail-loud（verify 强制）
- close 快速返回（<30s，daemon 不重试），gate 后台跑不阻塞前端
- errors 前端摘要 + 完整审计（`gate_last_errors` 跨 run）
- 纯增量，可独立回退（删新方法/列/migration down）
