---
author: flow-machine-draft
created_at: 2026-09-28T14:11:55.606Z
---
# 需求规格（Requirements）— 2026-09-28-fr-review-batch

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 263 条待复核条目逐条产出裁决：相符翻正（candidate 行 confirm 翻 active
Given 测试 相关模块就绪
When 263 条待复核条目逐条产出裁决：相符翻正（candidate 行 confirm 翻 active，无行
Then bind 真实测试）/ 绑定过时重绑 / 内容过时最小修正 / 特性已死标 superseded+退役理由 / 无测试面清标记留档报告

### FR-02: 每条翻正的证据路径必须是盘上真实测试形态文件（test_*.py / *.test.*），不许悬空路
Given 测试 相关模块就绪
When 每条翻正的证据路径必须是盘上真实测试形态文件（test_*.py / *.test.*），不许悬空路径
Then 行为符合本条标准描述

### FR-03: 复核完成的条目清除「待复核：」标记行，未复核的不动
Given 系统就绪
When 复核完成的条目清除「待复核：」标记行，未复核的不动
Then 行为符合本条标准描述

### FR-04: fr 文件条目格式不被破坏（标题/状态/场景正文/绑定子块结构保持）
Given 系统就绪
When fr 文件条目格式不被破坏（标题/状态/场景正文/绑定子块结构保持）
Then 行为符合本条标准描述

### FR-05: sillyspec knowledge validate 无 errors
Given 系统就绪
When sillyspec knowledge validate 无 errors
Then 行为符合本条标准描述

### FR-06: 分批（按域分波）处理，每波显式 pathspec 提交
Given 系统就绪
When 分批（按域分波）处理，每波显式 pathspec 提交
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 不适用：纯知识库复核，无代码测试面。验收证据=九域 fr 文件终态（提交 2f29e2693/b9f40ac17/4d34ed131/529f34e40/c23caca58/473c0b311/310cc5382/1fcb24f5b）：守恒核对 260 = 62 confirm + 8 重绑 + 142 新绑 + 38 无测试面 + 9 废弃 + 1 纯修正（用户口径 260 条已核实：初始 grep 计 263 含 backend 域 3 处场景正文文字引用误计） -->

<!--AGENT:测试绑定FR-02 不适用：同上。证据形态由 sillyspec tests CLI 强校验（--confirm 的 evidence 必须解析为盘上 *.test.*/test_*.py 形态文件，resolve 失败 exit 1）+ --bind 的路径存在性校验，212 条绑定/翻牌命令全过即机械化证明；2 条悬空 .ts 路径被发现并重绑为真实 .tsx -->

<!--AGENT:测试绑定FR-03 不适用：同上。验收证据=`grep -c '^待复核：'` 九域全部为 0（收口前实测）；范围外 candidate 存量 123 行未动 -->

<!--AGENT:测试绑定FR-04 不适用：同上。验收证据=sillyspec knowledge validate 六次分波运行 + 收口终验全部 ok=true 零 errors（validate 含条目结构/绑定块健康检查）；绑定子块全部经 CLI 写入未手改 -->

<!--AGENT:测试绑定FR-05 不适用：验收命令本身即 CLI 工具 sillyspec knowledge validate，非项目测试套件用例。收口前最后一次运行 ok=true、errors=[]、warnings=[] -->

<!--AGENT:测试绑定FR-06 不适用：同上。验收证据=git log：九域 8 笔分波提交（每笔显式 pathspec 单域文件 + 标题带 task-NN）+ 本收口提交，无跨域夹带 -->
