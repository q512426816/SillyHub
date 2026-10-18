---
author: flow-machine-draft
created_at: 2026-10-18T12:31:35.167Z
---
# 设计记录（Design Record）— 2026-10-18-change-type-git-conventional

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

平台想展示 git 惯用前缀式语义类型（feat/fix/docs/...），但语义类型只存在于本机
git 提交信息——平台侧无 git 历史，timeline.md 只有部分提交带标题（主提交常是裸
哈希）。选 flow-state.yaml 顶层新增可选字段 `commit_type` 作为数据通道：它随既有
spec-sync 镜像同步到平台，reparse 已扫该目录，零新增端点/零 migration。

三处改动：① backend parser 新增 `_read_flow_state_commit_type`（读到即覆盖目录
形状推断并置 `change_type_authoritative`；`_apply_parsed` 对权威值放开「只为空回填」
保护）；② `scripts/backfill_commit_type.py` 一次性回填存量——全量 git log 按提交
信息归属（见接口契约），主类型按优先级 feat/fix > perf/refactor/test > docs/style
> build/ci/chore/revert 取；③ 前端详情页「类型」行由纯文本改 git 风格彩色标签。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `ParsedChange` 新增字段 `change_type_authoritative: bool = False`（dataclass，
  向后兼容默认 False）。
- `ChangeParser._read_flow_state_commit_type(change_dir) -> str | None`：静态读取
  flow-state.yaml 顶层 `commit_type`（小写化、≤50 字符截断；缺文件/缺字段/非 str/
  空串/损坏 YAML → None fail-open 回落推断）。
- `ChangeService._apply_parsed`：change_type 覆盖条件由「仅库值为 None」放宽为
  「库值为 None **或** parsed.change_type_authoritative」；无权威标志的推断值仍
  只为空回填（change_writer 建行写入的语义类型不被猜测值回翻）。
- flow-state.yaml 文件格式新增顶层可选键 `commit_type`（CLI 后续版本 / 回填脚本
  写入；脚本幂等：行存在则原位替换、值相同不写、无则在末尾追加一行——最小 diff
  防同步噪音）。
- 前端「类型」行渲染 `CommitTypeChip`（data-testid=commit-type-chip）：已知前缀
  固定配色，未知中性显示原值，null 显示 —；旧枚举 `feature` 显示层等价映射为
  `feat`（数据不动）。对外 API/端点/表结构均无变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：commit_type 是终态事实（变更归档后主提交类型不再变），迟到
   只表现为「旧值→新值」的一次覆盖，无中间态依赖；脚本重跑替换同值幂等。
2. 并发写：flow-state.yaml 写入方为回填脚本（人工一次性，建议无并行变更时跑）
   与后续 CLI flow done（收口串行点）；平台侧 reparse 只读。脚本对 active 变更
   仅在 flow-state.yaml 已存在时写入、禁止为 active full 变更新建文件——否则
   `_infer_current_stage` 会把该变更误判 thin。
3. 切换/生命周期：脚本中断可安全重跑（幂等：unchanged/replaced/appended 三态）；
   parser 读损坏 YAML fail-open 返 None，不阻断 reparse 主流程。
4. 作用域：parser 逐 change_dir 读取，无跨工作区共享状态；脚本只在主仓根跑
   （CLAUDE.md 规则 22），git 反查限定本仓 --all 历史。

## 文件变更清单（提交面自声明）

代码与测试（提交 261a33367，随 tasks.md 勾选同一提交入库）：

- backend/app/modules/change/parser.py（_read_flow_state_commit_type + authoritative 字段接线）
- backend/app/modules/change/service.py（_apply_parsed 权威覆盖规则）
- backend/app/modules/change/tests/test_parser.py（TestCommitTypeFlowState 五用例）
- backend/app/modules/change/tests/test_reparse_guard.py（change_type 三分支持用例）
- frontend/src/components/changes/detail/change-overview-side.tsx（CommitTypeChip + 类型行）
- frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx（标签四用例）
- scripts/backfill_commit_type.py（存量回填脚本）

数据面（同提交）：.sillyspec/changes/{archive/,}*/flow-state.yaml ×426（244 追加一行
+ 182 新建最小文件，幂等复跑 unchanged）；.sillyspec/changes/2026-10-18-change-type-
git-conventional/ 变更工件。工作区另有 frontend/src/lib/api-types.ts 与
sillyhub-daemon/src/api-types.ts 两处未提交改动属并行会话在途（本会话开始前已存在，
与本变更无关，以 --accept-dirty-gap 处置不卷入）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：提交归属误判。两类实证坑已堵——① 跨变更引用（提交信息正文提及评审
出处变更 key）：按「信息中**最后一个** key 形态 token」归属，不按出现过即归属；
② CLI 基线检查点提交 `sillyspec: baseline checkpoint for <key> …` 的 `sillyspec:`
撞 conventional 前缀正则：类型白名单（feat/fix/perf/refactor/test/docs/style/
build/ci/chore/revert）外一律不认。残余面：变更唯一提及在 release-notes 类提交
里 → 归 docs（可接受，此类变更本就是文档面）；老变更提交不带 key（215 个
no_match）→ 不猜不写，保持现状显示。

试过放弃：A. 平台侧解析 timeline.md 提交锚——主提交只有裸哈希无标题，判不出
fix（实证：session-envelope 会错判 docs）；B. 标题/动机关键词推导——「防迟到旧值
覆盖」类中文概括无稳定关键词，猜错比不猜伤害大；C. 新增平台端点直写类型——要动
鉴权/审计面，而 spec-sync 镜像通道现成且 reparse 已消费该目录。
