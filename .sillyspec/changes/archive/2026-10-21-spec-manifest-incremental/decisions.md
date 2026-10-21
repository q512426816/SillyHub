---
author: flow-machine-draft
created_at: 2026-10-21T14:08:47.105Z
---
# 决策记录（Decisions）— 2026-10-21-spec-manifest-incremental

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：**未来新增清单写点漏盖章 → 增量流漏行**。缓解：四个写点（apply_ops / _write_spec_root 对齐 / soft_delete_change_dir / heal_manifest_tombstones）逐点内联盖章并带「2026-10-21」锚注释，模型列注释与各写点 docstring 均注明「新写点必须盖章」；增量端点语义上把 NULL 行排除（未盖章行不进增量流）反而是显式失败面——漏盖章表现为客户端漏看到该行，靠全量兜底可发现（CLI 侧将带定期全量对账，sillyspec 仓消费变更内做）。评审补强两处：heal 写点盖章（P2-1，原实现漏）与 get_manifest 先读版本后读行（P2-2，封 READ COMMITTED 双快照跳行窗口——多读行是幂等超集无害）。次风险：rename 软删使墓碑行累积增速略升（原来硬删的行现在留存）——与既有 delete op 墓碑同量级（月千级），且有 `landing_version` 后未来可做墓碑 GC，可接受。 放弃的方案：① 按 `version`（行级谱系）直接过滤——不同行计数不可比，语义错误。② `updated_at` 时间戳游标——时钟回拨/同秒多事务不可判定，且 DB 与应用时钟双源。③ ETag/If-None-Match 整体未变短路（无增量行）——只能省「无变化」场景，任何单行变化仍全量 2.2MB，治标不治本。④ 服务端缓存全量序列化按 spec_version 键控——省的是 0.9s 生成段，5s 传输段不动（带宽受限），收益不足。⑤ 只做响应瘦身（裁墓碑/字段）——上限 ~15%，不解决无界增长。
