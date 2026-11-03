---
author: flow-machine-draft
created_at: 2026-11-03T03:04:22.286Z
---
# 提案书（Proposal）— 2026-11-03-distill-prompt-fix

## 动机

任务原话转写：蒸馏提示词加固：转义回流悬空回落
平台触发的知识沉淀 prompt（backend/app/modules/knowledge/distill.py build_distill_prompt）经两轮评审与本机实测暴露四处问题：--body 双引号模板在正文含反引号或美元符时被 shell 展开静默损坏；spec_note 断言「会话结束自动上行、无需手动同步」不成立（propose 零同步，收尾上行 best-effort 且失败静默）；spec_dir 悬空引用时 propose 静默 mkdir 孤儿树（本机 4e9eb05b 实证 daemon 注册面零命中）；另缺来源标记、数量指引、查重与幂等说明。

成功标准：
- 模板 propose 命令改单引号 body 并带 --from 来源标记，附单引号转义与 category 枚举（known-issues 连字符）指引
- spec_dir 段改写为「落盘前 ls 核验；悬空回落当前工作目录 .sillyspec 并留痕偏差；禁止落自建孤儿目录」，删除「自动上行无需手动同步」表述
- 新增回流确认段：propose 后显式 sillyspec platform sync（不带 --change）并按回执留痕，未连接平台则汇报未回流
- 新增查重（search --query）/同题幂等/宁缺毋滥 2-5 条指引；resume 式补上下文摘要兜底句
- test_distill.py 既有 prompt 断言同步更新，backend 知识蒸馏测试全绿

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 模板 propose 命令改单引号 body 并带 --from 来源标记，附单引号转义与 category 枚举（known-issues 连字符）指引
2. spec_dir 段改写为「落盘前 ls 核验；悬空回落当前工作目录 .sillyspec 并留痕偏差；禁止落自建孤儿目录」，删除「自动上行无需手动同步」表述
3. 新增回流确认段：propose 后显式 sillyspec platform sync（不带 --change）并按回执留痕，未连接平台则汇报未回流
4. 新增查重（search --query）/同题幂等/宁缺毋滥 2-5 条指引；resume 式补上下文摘要兜底句
5. test_distill.py 既有 prompt 断言同步更新，backend 知识蒸馏测试全绿

## 成功标准（可验证）

1. 模板 propose 命令改单引号 body 并带 --from 来源标记，附单引号转义与 category 枚举（known-issues 连字符）指引
2. spec_dir 段改写为「落盘前 ls 核验；悬空回落当前工作目录 .sillyspec 并留痕偏差；禁止落自建孤儿目录」，删除「自动上行无需手动同步」表述
3. 新增回流确认段：propose 后显式 sillyspec platform sync（不带 --change）并按回执留痕，未连接平台则汇报未回流
4. 新增查重（search --query）/同题幂等/宁缺毋滥 2-5 条指引；resume 式补上下文摘要兜底句
5. test_distill.py 既有 prompt 断言同步更新，backend 知识蒸馏测试全绿
