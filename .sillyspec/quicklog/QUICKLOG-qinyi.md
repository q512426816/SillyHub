
## ql-20260919-001-25c7 | 2026-09-19 05:49:45 | update_entry 坏编码守卫——网页编辑非 UTF-8 文件不再静默毁坏 + probe docstring 勘误
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/knowledge/writer.py（_decode_knowledge_strict 共享 helper + update_entry 坏编码守卫）
- backend/app/modules/knowledge/tests/test_writer.py（新增 TestUpdateEncodingGuard 2 用例（守卫先红后绿+对照组））
- backend/app/modules/workspace/router.py（probe_workspaces docstring 勘误）
- .sillyspec/docs/SillyHub/modules/knowledge.md（注意事项截断坏编码口径三合一 + ql-20260919-001 增量）
- .sillyspec/docs/multi-agent-platform/modules/backend.changelog.md（变更索引新条目）
需求：update_entry 坏编码守卫——网页编辑非 UTF-8 文件不再静默毁坏 + probe docstring 勘误
根因：ql-20260918-005 只把 merge 回写路径 _read_raw 收口为严格解码，网页编辑链 GET 基底仍来自 parser._read_file_safe 的 errors=replace，坏编码文件（Windows GBK 残留）保存整文件替换即毁坏原字节且 update 不进 spec-backups；probe docstring 则是 ql-20260918-012 加 repo_url 回填写副作用时漏改前段只读表述（24h 审查 M1 残余缺口 + L1）
方案：writer.py 新增模块级 _decode_knowledge_strict 共享 helper（_read_raw 内联严格解码收敛进来，错误形态单一来源），update_entry 大小守卫后对磁盘原文严格解码探测（≤1MB，结果弃用只探测），坏编码抛既有 KnowledgeFileEncodingInvalid 422（details 带 byte_offset，文件与 manifest 版本不动）；router.py docstring 改为不改生命周期状态（唯一写例外 repo_url 回填）
结果：test_writer 27 全绿（新增 2 例先红后绿——坏编码 422+GET 基底含 U+FFFD 前置自检+磁盘原字节与 manifest 版本未动、合法 UTF-8 中文对照组不误伤）+ 相邻面 test_router/test_parser/test_distill 72 绿；ruff check/format 3 文件净、mypy scoped 0；docs gate 405=基线 405 放行
审计：[gate] L1（跨 0 模块 · 5 文件：2 代码/1 测试）advisory；每文件注记已全覆盖；测试增量已含

## ql-20260919-002-2378 | 2026-09-19 23:53:31 | tool-report-session-replay 双实现对撞深读后的合并收口——回带三处+格式串裁决（深读报告=设计依据…
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts（slotCallMeta锚定重构（MergedSlot去meta/锚定循环/UNANCHORED_META兜底/头注释））
- sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts（Z11翻转+正向锚定用例+Z12补产段断言）
- sillyhub-daemon/tests/agent-log-matrix.test.ts（ZCODE_MINI改滑动窗+M2/M4/M5锚定期望+交叉口径重构）
- frontend/src/lib/agent-log-turns.ts（孤儿结果未记录文本（R-03红线））
- frontend/src/lib/__tests__/agent-log-turns.test.ts（断言翻转）
- sillyhub-daemon/src/agent-log/registry.ts（格式串正典裁决注释）
需求：tool-report-session-replay 双实现对撞深读后的合并收口——回带三处+格式串裁决（深读报告=设计依据：主线基底略胜但rollout用量归属与孤儿编码两处失分）
根因：主线基底版两处语义缺陷：rollout兜底路径后写覆盖的用量/turnId归属失真（自家测试:661把宽松语义固化成契约）+孤儿tool_use的running编码踩R-03红线（已结束会话不得假运行）；对岸worktree实现在这两处更精确
方案：①parse-zcode-model-io.ts锚定重构——slotCallMeta产出调用锚（行N窗口末assistant锚行N-1元数据）替换槽位后写覆盖，未锚槽UNANCHORED_META全null（未知优于错值）；测试Z11翻转+正向锚定新用例、矩阵M2/M4/M5夹具改真实滑动窗（L1含R1）+锚定期望、Z12改补产段断言 ②agent-log-turns.ts孤儿tool_use轮定稿统一填「结果未记录（更早窗口外或中断）」+status=ok（R-03），测试翻转 ③残轮合并核对=主仓已等效（非真人起点轮prompt空串同worktree哨兵语义，豁免） ④系统事件双视图=TurnTimeline无systemMarkers支撑，组件级改动按报告可选项推迟 ⑤格式串裁决：-jsonl后缀族为正典（主仓内部已一致零代码变更，registry注释记录裁决+生产端现状）
结果：daemon agent-log定向196/196全绿（含锚定翻转与新增正向用例）；frontend agent-log-turns 15/15全绿；frontend+daemon双侧tsc --noEmit零错；CLI --done门禁亲跑隔离快照；④推迟与③豁免随QUICKLOG留档
审计：[gate] L1（跨 0 模块 · 6 文件：3 代码/3 测试）advisory；每文件注记已全覆盖；测试增量已含

## ql-20260920-001-c304 | 2026-09-20 01:09:20 | 红线机检种子清单首批两条落地（对撞实验两失分点的机检固化）
状态：已完成
关联变更：（无）
文件：
- .sillyspec/redlines.yaml（种子两条+YAML单引号正则书写规范注释）
需求：红线机检种子清单首批两条落地（对撞实验两失分点的机检固化）
根因：语义红线活在散文无机器可查形态，对撞实验两处失分三层评审352测试全漏
方案：.sillyspec/redlines.yaml 两条：RL-001 孤儿tool_use禁running编码/RL-002 用量归属禁后写覆盖，severity error + origin锚归档design
结果：探针11实弹：applicable 2条断言0命中0警告；正则单反斜杠书写教训记入文件头注释
