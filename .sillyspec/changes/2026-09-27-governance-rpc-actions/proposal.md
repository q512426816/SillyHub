---
author: flow-machine-draft
created_at: 2026-09-27T12:01:05.917Z
---
# 提案书（Proposal）— 2026-09-27-governance-rpc-actions

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:22fb1c9cbc2a3ac224eb7f5a4bcc2c1564845206c0d1ea24f16bc58337dbef61:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-governance-rpc-actions 留痕重锚 -->
任务原话转写：治理信号 v2 ①②：平台侧 _compute_governance_signals 与 CLI digest 双出口两份逻辑会漂移（绑定信号/基线消音平台侧缺失）；信号卡只读无动作按钮。收敛单源+动作回传。
成功标准：
- daemon 新增 knowledge.digest RPC（RuntimeHandler 同款 spawn 模式：root_path 三道校验→cwd=仓库根跑 sillyspec knowledge digest --json，stdout JSON 透传；缓存回退读点时降级跑——绑定信号随 cwd 缺工作树自然缺席）与 knowledge.action RPC（kind 白名单 repair-paths/redomain；域名参数过 [a-z0-9-]+ 元字符防线）
- backend governance 端点 RPC 优先（workspace 绑定 daemon 在线时直采 digest JSON 透传，含绑定信号），daemon 离线/method_not_found/超时回退本地计算（既有 _compute 保留为回退）
- POST /knowledge/governance/actions（KNOWLEDGE_WRITE）：kind+params→RPC 执行→返回输出尾部；伪域信号增 domains:[{name,count}] 数组供逐域迁移按钮
- frontend：坏绑定卡[执行 repair]按钮、伪域卡逐域[迁移到…输入目标域]按钮，mutation 后 refetch；daemon 离线时按钮降隐藏（本地计算模式无动作能力）
- daemon vitest（digest 透传/动作白名单/元字符拒）+ backend pytest（RPC 优先/回退/动作端点）+ frontend 组件测试（按钮/降级）
- 显式 pathspec 提交
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:aafdecc96a559bc58e86346a9a52b7273e7daf05e56fe355a5056ebbe79f156f:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-governance-rpc-actions 留痕重锚 -->
按成功标准机械推导，共 11 条验收面：
1. daemon 新增 knowledge.digest RPC（RuntimeHandler 同款 spawn 模式：root_path 三道校验→cwd=仓库根跑 sillyspec knowledge digest --json，stdout JSON 透传
2. 缓存回退读点时降级跑——绑定信号随 cwd 缺工作树自然缺席）与 knowledge.action RPC（kind 白名单 repair-paths
3. redomain
4. 域名参数过 [a-z0-9-]+ 元字符防线）
5. backend governance 端点 RPC 优先（workspace 绑定 daemon 在线时直采 digest JSON 透传，含绑定信号），daemon 离线/method_not_found/超时回退本地计算（既有 _compute 保留为回退）
6. POST /knowledge/governance/actions（KNOWLEDGE_WRITE）：kind+params→RPC 执行→返回输出尾部
7. 伪域信号增 domains:[{name,count}] 数组供逐域迁移按钮
8. frontend：坏绑定卡[执行 repair]按钮、伪域卡逐域[迁移到…输入目标域]按钮，mutation 后 refetch
9. daemon 离线时按钮降隐藏（本地计算模式无动作能力）
10. daemon vitest（digest 透传/动作白名单/元字符拒）+ backend pytest（RPC 优先/回退/动作端点）+ frontend 组件测试（按钮/降级）
11. 显式 pathspec 提交
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:cd8e4226e1ed8a603be89bc886873a6f2a92f57749d8c7f8d5147bd94afc69d9:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-governance-rpc-actions 留痕重锚 -->
1. daemon 新增 knowledge.digest RPC（RuntimeHandler 同款 spawn 模式：root_path 三道校验→cwd=仓库根跑 sillyspec knowledge digest --json，stdout JSON 透传
2. 缓存回退读点时降级跑——绑定信号随 cwd 缺工作树自然缺席）与 knowledge.action RPC（kind 白名单 repair-paths
3. redomain
4. 域名参数过 [a-z0-9-]+ 元字符防线）
5. backend governance 端点 RPC 优先（workspace 绑定 daemon 在线时直采 digest JSON 透传，含绑定信号），daemon 离线/method_not_found/超时回退本地计算（既有 _compute 保留为回退）
6. POST /knowledge/governance/actions（KNOWLEDGE_WRITE）：kind+params→RPC 执行→返回输出尾部
7. 伪域信号增 domains:[{name,count}] 数组供逐域迁移按钮
8. frontend：坏绑定卡[执行 repair]按钮、伪域卡逐域[迁移到…输入目标域]按钮，mutation 后 refetch
9. daemon 离线时按钮降隐藏（本地计算模式无动作能力）
10. daemon vitest（digest 透传/动作白名单/元字符拒）+ backend pytest（RPC 优先/回退/动作端点）+ frontend 组件测试（按钮/降级）
11. 显式 pathspec 提交
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
