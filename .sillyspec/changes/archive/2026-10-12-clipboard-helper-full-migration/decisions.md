---
author: flow-machine-draft
created_at: 2026-10-12T02:28:26.360Z
---
# 决策记录（Decisions）— 2026-10-12-clipboard-helper-full-migration

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：- 风险：机械迁移面大（15 文件）——以 grep 验收残留清零 + 全部触碰组件既有测试全绿 + tsc/eslint 门兜底；改动形态单一（换调用源），无逻辑重写。 - 放弃方案 A：只迁移「重要」调用点（命令卡/ID）留其余——半迁移态更不一致，且每处都同样机械，全量一次收口。 - 放弃方案 B：各组件就地复制降级逻辑——违背单一实现（helper 头注即为此而设），后续维护面翻倍。
