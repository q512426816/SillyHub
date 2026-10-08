---
id: task-07
title: '图谱页三栏：查询/默认 orphans/lite 数据面/补全/详情深链/六键引导/CLI 提示条'
title_zh: '图谱页三栏：查询/默认 orphans/lite 数据面/补全/详情深链/六键引导/CLI 提示条'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-08 17:50:00
priority: P0
depends_on: [task-06]
blocks: [task-09, task-10]
requirement_ids: [FR-05, FR-06]
decision_ids: [D-002@v1, D-006@v1, D-008@v2]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx
target_files:
  - NEW:frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx
goal: >
  「知识图谱」子页签页面：三栏布局（左查询+预置+图例 / 中画布 / 右详情+结果 tab），默认 orphans 治理切片，
  lite 总览数据面（点代表下钻），锚点自动补全，节点深链知识库，六键 unavailable 引导。
implementation:
  - 页面骨架三栏：左 300px（antd 组件+主题 token 类名）；中 GraphCanvas（task-06）；右 340px 三 rtabs（节点详情/查询结果/使用说明）
  - 查询表单：sub 下拉（五查询）+ anchor/anchor2 输入（补全）+ edges 下拉（all+16 型）+ depth 1-3；预置演示六胶囊（impact 变更/neighbors FR/path 决策→模块/orphans/dangling/文件反查）；等价 CLI 提示条（黑底等宽，动态拼 sillyspec knowledge graph <sub> <anchor>）
  - 默认视图（D-006）：首载 overview 可用即自动 orphans 查询（warn 红环+右栏孤儿清单卡+mode-chip）
  - lite 数据面（D-008@v2）：胶囊「总览 lite/查询切片」；lite=overview.summary.clusters 渲染（summary=None 时胶囊隐藏）；状态机——执行查询或点代表节点→切切片模式（代表=锚点发起 neighbors），胶囊手动回 lite
  - 锚点补全：debounce 300ms 调 nodes 端点下拉候选（id+type 徽标）；请求不可用（旧 CLI）→ 静默禁用补全不报错
  - 节点详情：色点+label+类型 chip+attrs kv+按边型分组出入邻居清单（dir/edge_type 从 edges[] 派生 s→t）；行点击→跳选画布节点；entry 类节点加「在知识库打开」链接 → /knowledge?file=&anchor=（page.tsx:274-279 深链惯例）
  - 查询结果 tab：ok/warn 左条结果卡 + path 不可达 reason 文案展示（强边寻路语义注记）
  - 六键 unavailable：全页降级卡（unbound=绑定引导按钮跳绑定入口/offline·timeout=稍后再试/upgrade_required=升级 daemon·sillyspec 提示/invalid_input=输入错误/rpc_error=服务异常）；isPending 骨架
  - 图例：节点 10 类型（点击过滤高亮）+ 边 16 型三档（hover/点击该型高亮）；三档强度说明 chips
acceptance:
  - 原型交互集全覆盖（缩放/平移/拾取/一跳高亮/dim/mode-chip/图例过滤/重置）
  - 三态（pending/六键 unavailable/可用渲染）+ lite↔切片状态机正确
  - 全中文文案；三主题合规
verify:
  - cd frontend && pnpm exec tsc --noEmit && pnpm lint
constraints: >
  全中文文案；默认 orphans 视图首载即发起（D-006）；lite↔切片状态机按 design 钉死
---
# task-07
