---
author: flow-machine-draft
created_at: 2026-10-08T17:23:10.573Z
---
# 决策记录（Decisions）— 2026-10-08-shared-assertion-surfaces

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：清单自身腐化（新增共享断言面不登记、钉子测试移动不更新条目）——缓解：条目末尾写明「新面按同款登记」的口径，且知识条目进 distill 链可被后续 knowledge 命令校验。放弃方案：CI 内自动扫描钉子断言生成清单（AST/grep 解析 toHaveLength/toEqual 钉子反查契约）——跨语言三端解析成本高且误报难消，先人工登记验证命中价值再谈自动化。
