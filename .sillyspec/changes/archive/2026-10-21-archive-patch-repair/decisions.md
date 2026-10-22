---
author: flow-machine-draft
created_at: 2026-10-21T04:36:09.459Z
---
# 决策记录（Decisions）— 2026-10-21-archive-patch-repair

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是手工修准与 CLI 未来版本的 schema 演进漂移——缓解：键集不变只修值、repair 为纯新增字段（后端投影对未知键 fail-open，schema.py 侧 assets 读取面已核），且 verdict 枚举已从后端权威源查证（`planned/unplanned/untouched`，schema.py:745），无需凭空造值。放弃方案：① 接受现状不动——平台卡面持续误导 + 未来 FR 归属按错误清单污染，且 review.json 的 git-diff 权威面在历史压扁后成孤儿引用，评估已否；② 只追加 repair-note 文件不动冻结件本体——半吊子修复，卡面照旧错，不解决用户可见面；③ CLI 官方通道重建——`flow` 子命令无重建能力（已归档注销）、`--reopen` 属厚流程阶段机、知识库无先例，通道不存在。仓内已有 `patch-reanchor` 命令（归档后锚点修复）先例，佐证归档后修复在该流程文化下是被认可的形态（本变更为其内容面扩展，手工执行）。
