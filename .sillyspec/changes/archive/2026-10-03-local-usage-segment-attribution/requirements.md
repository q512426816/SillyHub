---
author: qinyi
created_at: 2026-10-03
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 工作区成员 | 查看变更中心用量的用户——期望每个变更的本地用量是其实际消耗，不被后续变更抢走 |
| 本地 CLI | 同一会话内可能连续操作多个变更（既有上报协议不变） |

## 功能需求

### FR-01: 上报时记录水位（ctx 接管时点累计值）
覆盖决策：D-001@v1, D-002@v1, D-004@v1
Given CLI 上报 entry（带 change_key 或 quick_id 或双空）
When backend 执行 upsert（行覆盖前）
Then 插入一行水位记录：ctx + 当行**已落库**五项累计值（invocations/四维 token，无旧行或 NULL 快照按 0）+ reported_at；随后既有覆盖与绑定照旧

Given 同一 entry 连续多次同 ctx 上报
When 每次上报
Then 每次都插水位（聚合差分自然合并，不做写入端合并）

Given 某 entry 水位行数超过 200
When 插入新水位
Then 修剪中段旧水位至约 200 行，**首水位（隐式起点锚定载体）与末水位（待消费锚点）恒豁免**（D-003@v2，复审 L1——首水位被删会使基线段转移给新首 ctx）

### FR-02: 聚合本地段改水位差分（双路径）
覆盖决策：D-001@v1, D-002@v1
Given 变更 X 的某日志 entry 存在水位行
When 聚合 X 的本地用量
Then X 的量 = Σ over 水位 w(ctx=X)：max(0, 下一水位值 − w 值) 五项（无下一水位取 entry 当前快照值）；api_requests 取 invocations 差分；时间三元组维持 first/last_seen 口径（caliber-fix 既有行为）

Given 某 entry 无水位行（存量/回填数据）
When 聚合
Then 走既有整行快照路径（数字与改造前一致）；同一 entry 两条路径互斥不双计（有水位即不走整行）

Given 水位 ctx 双 NULL（无变更上下文的上报）
When 聚合
Then 该差分片段不计入任何变更

Given quicklog（quick_id 水位）
When 聚合
Then 与变更同构

### FR-03: 时序守恒
覆盖决策：D-002@v1
Given 序列：上报(ctx=A) → 异步摄取刷快照至 V（含 A 尾巴）→ 上报(ctx=B)
When 计算 A 与 B 的量
Then A = mark_B − mark_A（含尾巴）、B = 当前快照 − mark_B——Σ = 文件累计，无缺口无重叠（max(0,·) 防御重置类异常）

### FR-04a: 摄取滞后边界（D-002@v2）
Given 序列：上报(ctx=A) → 上报(ctx=B)（A 时期摄取尚未落库）→ 摄取刷总量 → 上报(ctx=C)
When 计算 A/B/C 与文件累计
Then Σ(A,B,C 各得量) = 文件累计（守恒）；A 尾巴 token（滞后落库部分）归 B 差分（边界声明：后继多计/前驱少计，窗口=一次摄取延迟）；invocations 同步值无错归

### FR-04b: 存量首水位锚定（D-004@v1）
Given 存量 entry 已有回填基线 V0（无水位行），CLI 全量重推（ctx=X）
When 首次上报插首水位 mark=V0 后聚合
Then [0,V0) 段归 X（首水位差分起点 0）——与改造前整行归属同值同主，数字连续平滑迁移；测试断言重推前后变更 X 数字一致

### FR-04: 兼容与回退
Given 存量 410 条回填快照（无水位）
When 上线后聚合
Then 数字与改造前一致（整行路径）

Given 迁移回退（downgrade）
When 执行
Then 水位表删除，聚合全部回落整行路径（与改造前一致）；API/DTO 零变化

## 非功能需求

- 水位插入在上报事务内（与 upsert 同事务，不加锁不加队列）；修剪单条 SQL。
- 聚合保持批量单查询零 N+1（水位差分在 SQL 侧完成，不拉行进 Python）。
- 可测试性：守恒/切换/存量兼容均有确定性单测。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02 | 水位差分协议本体（否决不覆盖/接受现状） |
| D-002@v1 | FR-01, FR-03 | 水位语义（接管时点已落库累计，差分归前 ctx） |
| D-003@v1→@v2 | FR-01 | 修剪治理（豁免首末水位） |
| D-002@v2 | FR-04a | 摄取滞后边界声明（supersedes D-002@v1 断言） |
| D-004@v1 | FR-01, FR-04b | 首水位锚定（存量平滑迁移） |

## 测试绑定（收编追加——每条 FR 至少一行：test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名，如 test/foo.test.mjs「用例组」或 test/foo.test.mjs#用例；无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名，如 test/foo.test.mjs「用例组」或 test/foo.test.mjs#用例；无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名，如 test/foo.test.mjs「用例组」或 test/foo.test.mjs#用例；无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名，如 test/foo.test.mjs「用例组」或 test/foo.test.mjs#用例；无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
