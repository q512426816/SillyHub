# verify 探针 7「验收×测试覆盖矩阵」预填噪音四缺陷（假 covered/目录级候选灌水/锚点空心/真 covered 误标 partial）

> 记录时间：2026-10-16 · 来源变更：2026-10-16-backend-mem-polling verify 收口实测
> 状态：已修复并移入 finished/（sillyspec@2026-10-16-probe7-prefill-noise-fix，实现 5ca368a0 / 归档 d118e023，2026-10-16）——四缺陷逐条落地：①部署/文档类条目直判 non-testable + 全条目命中卡不注入 FR 候选池；②covered 仅测试名级命中（锚点=测试函数名行），正文命中封顶 partial；③同波次新增/修改测试零命中 → covered+待人工复核；④候选>5 交人工。回归断言锁在 sillyspec 仓 test/probe7-prefill-noise.test.mjs（6 用例）+ 既有 probe7 测试面改写

## 背景

verify 收口的探针 7 生成「验收条目 × 承接测试文件」矩阵（本变更 10 任务约 30 行），
判定五选一（covered/covered-service/partial/uncovered/non-testable）+ 证据锚点，
fail-closed 强制逐格填——机制本身好，问题在 CLI 预填质量。

## 缺陷一：目录级候选池 join → 单元格灌 130+ 个不相干测试文件（归属源过宽）

现象：task-09（compose 配额验收）的「归属测试文件」列灌入 130+ 个文件——从
`agent/tests/test_agent_session_model.py` 到前端 `.test.tsx` 到 daemon 测试，
与 docker 配额毫无关系（task-09/10 两行各附 130+ 路径长清单）。

根因：任务卡 allowed_paths 指向无测试目录（compose/Dockerfile）时，回退到 FR 索引
的「既有用例候选（FR 关联回归面）」目录级候选池整体 join，不做任务类型区分。

期望修复：deploy/config/doc 类验收条目直接预填 non-testable，不做候选池 join；
代码类任务的候选池也应收窄（见缺陷四）。

## 缺陷二：正文关键词命中即预填 covered → 假 covered + 空心证据（最危险）

现象：上列 130+ 候选中，`test_agent_session_model.py:37` 附近出现"config"字样
（docstring/注释级），预填判定 **covered**、证据 `test_agent_session_model.py:37（config）`
——一个 agent 模型测试文件里的"config"单词被当作 docker 配额验收的通过证据。
本变更此类假 covered 格子 8 个（task-09 两行其一、task-01~08 各处）。

根因：预填规则「有归属且命中≥1→covered」把**正文内容词匹配**与**测试名匹配**
同等对待；锚点取关键词首现行号（指向 docstring 而非 `def test_*` / `it('...')`
断言行），证据形式合规（file:line 能过机器校验）但语义为空——审计矩阵变假审计面。

危害：这是四缺陷中唯一「看起来合理实则错误」的——复核者若放行，垃圾锚点直接进
变更档案；复核者认真核对，则每个假 covered 都要花「识别错误→改写」的双倍成本。

期望修复：正文关键词命中最多预填 partial（+「待人工」注记），永远不自动 covered；
covered 只允许测试函数名/测试用例名级命中；锚点必须指向测试函数名，禁止取关键词行号。

## 缺陷三：真 covered 被标 partial（方向相反，浪费但安全）

现象：task-04「_pending_rpcs 三路径不残留」有直接断言的新测试
（TestPendingRpcsCleanup 两例），归属列也正确指向 `test_ws_hub.py`，但关键词
字面量未命中测试文件正文 → 预填 partial +「（无机械命中——人工核验）」。
task-01/02/05/06/08 同款共 6 格。

根因：关键词匹配是验收条目散文 vs 测试文件正文的字面交集，对「测试名是验收条目
的同义改写」零识别（如验收写"_pending_rpcs 不残留"、测试叫
`test_send_rpc_external_cancel_cleans_pending`——语义覆盖但字面不交）。

期望修复：partial 是安全方向的误判可保留，但可加一层提升信号：测试文件与任务卡
同波次新增/修改（git diff 面）即预填 covered + 待人工复核注记，减少无谓改写轮。

## 缺陷四：假 covered 8 格 + 真 partial 6 格 + 预填直接可用仅 ~2 成 → 预填净成本为负

实测账（本变更）：预填约 30 格，直接可用约 6 格（恰因新测试文件名含验收条目字面
关键词——巧合非机制）；人工三轮改写 14+14 格、docs-only 预检再拦 2 格。
fail-closed 强制逐格过，净效果 = 先读一遍错的、再改写成对的，比从零填更贵。

## 修复建议汇总（按优先级）

1. 归属源收窄四选一：allowed_paths 同目录测试 / 任务卡 verify 命令点名的测试 /
   git diff 实际改动的测试文件 / 下游消费卡测试；FR 索引 join 仅对代码任务开；
2. 正文关键词命中封顶 partial；covered 仅测试名级命中；
3. 锚点必须指向测试函数名（不取关键词行号）；
4. 候选 >5 直接输出「归属不可判定→uncovered 交人工」，禁止目录级候选长清单进单元格
   （顺带治 verify-result.md 文档膨胀——本变更该文件因两段 130+ 路径清单膨胀 200+ 行）。
