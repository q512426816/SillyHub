---
author: flow-machine-draft
created_at: 2026-10-20T00:16:49.178Z
---
# 提案书（Proposal）— 2026-10-20-conflict-platform-archive

## 动机

任务原话转写：冲突对比平台留档快照自足回退

动机与背景：坑 conflict-compare-full-tree-label-mismatch（docs/sillyspec/，2026-10-16 生产实证 + 2026-10-17 真机复验）——spec-sync 冲突 open 行（spec_conflicts）只存路径清单，对比硬依赖机器本地记录（spec-sync-conflict-*.json）经 daemon RPC 实时读取；记录随同步清理/裁决消亡而行只在「下一次全绿推送」或手动关闭时消失，「行开记录亡」态下对比恒 502（conflict_record_missing），且 10-17 实测证明「请重新同步」对定向同步类冲突不可行动（产品内刷新不再生树冲突记录）。坑文建议修复方向：「提供平台侧差异视图（不依赖机器本地记录）」。

关键洞察：被拒 op 本身携带机器侧内容（add/update 的 base64 content 与 mtime，rename 目标路径）——冲突推送发生时机器侧状态已在请求里，平台侧留档零新增 RPC、零时序竞态（机器记录是 CLI 收到推送响应后才落盘的，服务端主动抓取必竞态）、零 workspace-机器绑定依赖（Workspace 表无 instance 绑定）。

成功标准：
- 冲突推送（base_version 乐观锁冲突/墓碑拦截/rename 目标占用六类被拒点）时，被拒 op 的机器侧内容蒸馏留档进 open 行 details_json.local_archive（单文件文本 32K 字符帽截断留标记、总量 512KB 帽超出停存内容仅留路径清单、300 文件帽），推送主流程零新增 RPC 且留档失败不阻断
- 对比端点在 daemon 返回 conflict_record_missing 且行内 local_archive 覆盖所请求变更路径时，以留档构造对比响应（record_label=platform-archive、covered_changes/path_total 同口径裁剪），平台侧仍实时读 spec_root——记录亡后对比不再 502
- 无留档或留档不含所请求变更路径时，错误路径与现状逐字节一致（四臂文案不变）
- 前端对比弹窗对 record_label=platform-archive 显示留档来源横幅（平台留档快照·冲突时点机器侧内容 vs 平台当前内容）
- 既有对比/增量同步/墓碑守卫测试零回归，新增后端留档构建+回退与前端横幅测试

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 冲突推送（base_version 乐观锁冲突/墓碑拦截/rename 目标占用六类被拒点）时，被拒 op 的机器侧内容蒸馏留档进 open 行 details_json.local_archive（单文件文本 32K 字符帽截断留标记、总量 512KB 帽超出停存内容仅留路径清单、300 文件帽），推送主流程零新增 RPC 且留档失败不阻断
2. 对比端点在 daemon 返回 conflict_record_missing 且行内 local_archive 覆盖所请求变更路径时，以留档构造对比响应（record_label=platform-archive、covered_changes/path_total 同口径裁剪），平台侧仍实时读 spec_root——记录亡后对比不再 502
3. 无留档或留档不含所请求变更路径时，错误路径与现状逐字节一致（四臂文案不变）
4. 前端对比弹窗对 record_label=platform-archive 显示留档来源横幅（平台留档快照·冲突时点机器侧内容 vs 平台当前内容）
5. 既有对比/增量同步/墓碑守卫测试零回归，新增后端留档构建+回退与前端横幅测试

## 成功标准（可验证）

1. 冲突推送（base_version 乐观锁冲突/墓碑拦截/rename 目标占用六类被拒点）时，被拒 op 的机器侧内容蒸馏留档进 open 行 details_json.local_archive（单文件文本 32K 字符帽截断留标记、总量 512KB 帽超出停存内容仅留路径清单、300 文件帽），推送主流程零新增 RPC 且留档失败不阻断
2. 对比端点在 daemon 返回 conflict_record_missing 且行内 local_archive 覆盖所请求变更路径时，以留档构造对比响应（record_label=platform-archive、covered_changes/path_total 同口径裁剪），平台侧仍实时读 spec_root——记录亡后对比不再 502
3. 无留档或留档不含所请求变更路径时，错误路径与现状逐字节一致（四臂文案不变）
4. 前端对比弹窗对 record_label=platform-archive 显示留档来源横幅（平台留档快照·冲突时点机器侧内容 vs 平台当前内容）
5. 既有对比/增量同步/墓碑守卫测试零回归，新增后端留档构建+回退与前端横幅测试
