---
author: flow-machine-draft
created_at: 2026-09-27T12:01:05.919Z
---
# 任务注册表（Tasks）— 2026-09-27-governance-rpc-actions

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: daemon 新增 knowledge.digest RPC（RuntimeHandler 同款 spawn 模式：root_path 三道校验→cwd=仓库根…
- [x] task-02: 缓存回退读点时降级跑——绑定信号随 cwd 缺工作树自然缺席）与 knowledge.action RPC（kind 白名单 repair-paths
- [x] task-03: redomain
- [x] task-04: 域名参数过 [a-z0-9-]+ 元字符防线）
- [x] task-05: backend governance 端点 RPC 优先（workspace 绑定 daemon 在线时直采 digest JSON 透传，含绑定信号）…
- [x] task-06: POST /knowledge/governance/actions（KNOWLEDGE_WRITE）：kind+params→RPC 执行→返回输出尾部
- [x] task-07: 伪域信号增 domains:[{name,count}] 数组供逐域迁移按钮
- [ ] task-08: frontend：坏绑定卡[执行 repair]按钮、伪域卡逐域[迁移到…输入目标域]按钮，mutation 后 refetch
- [ ] task-09: daemon 离线时按钮降隐藏（本地计算模式无动作能力）
- [ ] task-10: daemon vitest（digest 透传/动作白名单/元字符拒）+ backend pytest（RPC 优先/回退/动作端点）+ frontend 组件…
- [ ] task-11: 显式 pathspec 提交
