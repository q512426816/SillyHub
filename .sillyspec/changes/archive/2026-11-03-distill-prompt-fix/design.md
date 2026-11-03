---
author: flow-machine-draft
created_at: 2026-11-03T03:04:22.286Z
---
# 设计记录（Design Record）— 2026-11-03-distill-prompt-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：纯 prompt 文样工程，只改 `backend/app/modules/knowledge/distill.py` 的 `build_distill_prompt` 拼装面（resume 式 source_line 一句、propose_cmd 命令模板、spec_note 落盘指引、新增公共「传参规则 + 回流确认」段、提炼要求补查重/幂等/数量条目），不动 dispatch、取数、导出渲染逻辑。方案依据：用户转写的两轮提示词评审反馈 + 本机 sillyspec 3.34.0 实证（--from 受支持；--spec-dir 悬空时 propose 静默 mkdir 孤儿树；platform sync 静默忽略 --spec-dir、根解析走 cwd/.sillyspec-platform.json 指针；knowledge search 必须 --query 传参；propose 同题幂等 update）。命令模板换单引号 body 从源头规避 shell 展开损坏；spec_note 改核验回落规则替代失实的「自动上行」承诺；回流确认段把验证动作显式化进提示词。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：`build_distill_prompt` 签名不变（参数、返回类型 str 均不动）；HTTP/API 面、DB、CLI 调用面零变化。行为变化仅限生成 prompt 的文样内容：命令模板新增 `--from "session-spec"`→`--from "session-distill"` 标记与单引号 body 形态；spec_dir 非空时落盘指引改为核验回落文样；全形态新增回流确认段与查重/幂等/数量指引；resume 式新增摘要兜底句；删除「自动上行」「无需你手动同步」表述。spec_dir=None 旧形仍不出现 --spec-dir（零回归），但公共段（传参规则、回流确认、查重）在旧形同样出现。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   答：不适用——纯函数字符串拼装，无输入时序面；任意调用顺序产出仅由入参决定。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   答：无共享可变状态，模板只读模块级常量；并发请求各自得到独立字符串，无串写面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   答：安全——无状态；prompt 生成后交执行 agent 落地，中断后重新生成结果幂等（同入参同输出）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   答：不会——spec_dir 值由 dispatch 按工作区传参注入，文样不内嵌任何具体工作区标识；不触跨仓/多实例数据面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是指引属软约束——执行 agent 仍可能忽略单引号/核验/回流规则（prompt 级护栏无硬门）；缓解=文样给出可逐字照抄的命令模板与判别性规则，且 propose 产物带 status: pending_review 进评审闭环兜底。放弃方案一：在 sillyspec CLI 侧为 propose 加 --spec-dir 注册面校验警告——治本但跨仓改 CLI，超出本仓变更授权面，留档为工具改进建议；放弃方案二：在本变更内修 .sillyspec-platform.json 指针误指（b97f8231）——属运行环境/运维问题，与本模板文样变更无关，且指针由平台 scan/init 机制维护，应走正规重建途径另行处理。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/knowledge/distill.py | build_distill_prompt 模板文样：resume 摘要兜底句、propose_cmd（单引号 body + --from）、spec_note 核验回落、公共传参规则与回流确认段、提炼要求补条 |
| 修改 | backend/app/modules/knowledge/tests/test_distill.py | prompt 断言更新为新文样 + 旧表述反断言 + legacy 公共段断言 |
