---
id: task-03
title: 'graph_layout lane 计算器纯函数 + 七类拓扑单测（含窗口一致性与 lookahead 退化）'
title_zh: 'graph_layout lane 计算器纯函数 + 七类拓扑单测（含窗口一致性与 lookahead 退化）'
author: 'qinyi'
created_at: 2026-08-25 21:37:20
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-06]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/git_log/graph_layout.py
  - backend/app/modules/git_log/tests/test_graph_layout.py
goal: >
  实现 graph_layout.py 纯函数 lane 计算器（Gitea modules/git/graph 算法移植），为泳道图提供确定性 lane/edges 预计算（D-004 后端算坐标、前端纯渲染），并用七类拓扑单测锁行为。
provides:
  - contract: GraphLayout
    fields:
      - 'compute_lanes(CommitRef→CommitLayout.lane+edges)'
      - '契约细目（§7.3）——入参 Sequence[CommitRef]（index/hash/parents 全长哈希、新→旧序），返回 list[CommitLayout]（index/lane/edges），Edge 含 to_index/to_lane/kind（straight 或 curve）；同前缀同输出，窗口截取不影响前缀 lane 分配'
implementation:
  - 新建 graph_layout.py 实现 compute_lanes 纯函数（无 IO/无随机/无全局状态）——有序活跃 lane 槽位集合，当前 commit 命中槽则输出该槽，分叉取最左空闲槽，merge 多 parent 依序找槽且可复用已活跃槽，槽内最后引用离开后回收供后续分叉复用（lane 编号紧凑，§5.3）
  - edges 仅含目标仍在结果集内的父边（结果集外 parent 不产边——对应分支/作者过滤与 lookahead 截断语义）
  - 新建 tests/test_graph_layout.py，覆盖 §5.5 七类拓扑用例 + 确定性断言（同一前缀重复调用输出全等）
acceptance:
  - 线性链——全部 commit lane=0 且父边 kind 均为 straight
  - 分叉——第二分支取最左空闲槽，lane 编号连续无空洞
  - 合并——merge commit 各 parent 边复用或指派正确槽位（to_lane 断言）
  - 复合——分叉+合并混合拓扑 lane 分配稳定且与手工推演一致
  - 槽回收——分支终结后槽位回收并被后续分叉复用（lane 编号回到紧凑态）
  - 窗口一致——同一序列取 [skip, skip+limit) 窗口后，窗口内 lane 与全量计算逐条一致
  - lookahead 退化——父边目标超出 lookahead(50) 时该边不绘制（不出现在 edges），lane 编号不变
  - 确定性——同一输入多次调用输出完全一致（含等价输入的不同构造顺序）
verify:
  - cd backend && uv run ruff check app/modules/git_log/graph_layout.py && uv run pytest app/modules/git_log/tests/test_graph_layout.py -q --no-cov
constraints:
  - 纯函数不碰 RPC/DB/文件系统；不做颜色与主题分配（前端职责，D-001）
  - 不改动 router/service/schema（task-02 产物）；不引入第三方图形/布局库
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
