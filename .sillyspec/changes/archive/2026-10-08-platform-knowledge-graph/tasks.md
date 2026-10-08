---
author: qinyi
created_at: 2026-10-08 17:05:00
---
# 任务清单（Tasks）

> 初版清单（brainstorm）；plan 阶段展开为 Wave + 任务卡并回写本文件。
> 跨仓前置（sillyspec 仓 graph summary/nodes 子命令）不在本清单——由该仓独立变更交付，本变更以能力探测降级对接（FR-08）。

- [x] task-01: daemon `knowledge.graph` RPC handler——子命令白名单 / anchor·anchor2·search 三参数同一黑名单 sanitize（先例正则全集+控制字符）/ 锚点位置参数引号包裹拼串 / edges 枚举∪{all} / depth·limit·search 钳制 / 30s 超时 / 旧 CLI 三态细分回码（method_unregistered·cli_subcommand_missing·cli_feature_missing:<sub>）/ 消毒拒绝 validation_rejected / orphans·dangling items 裁剪 top-50 count 保真 / root 双防线复用（runtime-handler.ts + daemon.ts 注册）
- [x] task-02: backend 图端点——schema.py 信封（reason 六稳定键 D-001@v2）+五查询/overview（轻量计数型）/nodes 分型 DTO（neighbors 键名对齐 CLI·path 含 found/reason/hop_count）+ graph.py KnowledgeGraphService（绑定发现→RPC 直采→异常族→六键映射，overview 三 RPC 逐条容错 summary 独立降级，无本地回退）+ router.py 三端点（注册在 {filename:path} 通配前，KNOWLEDGE_READ） (depends_on: task-01)
- [x] task-03: backend 测试——RPC mock 五查询（_FakeHub 范式）+ 六键 reason 全态 + 权限 403 + 路由序（字面量不被通配吞）+ overview 子块独立降级（cli_feature_missing:summary）+ items 截断 (depends_on: task-02)
- [x] task-04: daemon handler 测试——白名单外拒绝 / anchor·anchor2·search 三参数注入尝试（元字符·控制字符·引号逃逸）拒绝 / 正常节点 id（/#:@）放行 / edges 含 all 放行枚举外拒绝 / 钳制越界 / 旧 CLI 三态回码 / 裁剪 top-50 (depends_on: task-01)
- [x] task-05: gen:types + 前端数据链——pnpm gen:types 提交 openapi.json/api-types.ts + lib/knowledge.ts 图函数与类型导出 + query-keys.ts 图 key (depends_on: task-03)
- [x] task-06: graph-canvas 组件——力场 Verlet 直译（≤200 节点；>200 确定性静态布局降级：类型分环同心圆+mode-chip 标注）/拾取/hover/拖拽/缩放/fitView/标签分级/节点类型色 CSS 变量注入/边三档虚实；力场·静态布局·lite 簇摆放函数导出纯函数 (depends_on: task-05)
- [x] task-07: 图谱页——三栏布局/查询表单+预置+图例/默认 orphans 视图/lite 总览数据面（簇气泡+代表节点静态布局，状态机：查询或点代表→切切片模式·胶囊手动回 lite）/锚点补全（探测降级静默禁用）/节点详情与邻居跳选（dir·edge_type 从 edges 派生）/path 不可达 reason 文案/entry 深链/绑定引导六键文案/等价 CLI 提示条 (depends_on: task-06)
- [x] task-08: 页签与图卡——workspace-tabs 加「知识图谱」+ OpsDashboard 图维度卡（孤儿/悬空+点开清单+跳转图谱页+绑定引导+`?? []` 防御） (depends_on: task-05)
- [x] task-09: 前端测试——graph-canvas 纯函数单测（力场步进/拾取最近者/fitView 包围盒/>200 静态降级触发/lite 簇摆放）+ 页面三态与 lite↔切片状态机 mock + 图卡三态 + tsc/eslint (depends_on: task-07, task-08)
- [x] task-10: 端到端验收——本地起服实测：五查询闭环/三主题换肤截图/六键降级（断 daemon·模拟旧 CLI·未绑定·消毒拒绝）/lite 总览与补全探测隐藏/清单 top-50 截断与 count 保真/OpsDashboard 图卡跳转 (depends_on: task-09)
