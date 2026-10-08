---
author: qinyi
created_at: 2026-10-08 19:10:00
---
# UI 视觉证据（Visual Evidence）— 2026-10-08-platform-knowledge-graph

> 本变更 UI 面的渲染对照证据。真实浏览器截图依赖 worktree 代码进 docker 栈（main 镜像无新端点），
> 已列 verify-e2e.md 部署后验证清单；执行期以交互形态钦定原型实测 + 组件测试断言双轨留证。

## 形态对照证据（执行期）

1. **交互形态钦定源**：上游归档原型 prototype-knowledge-graph.html 已于 brainstorm 阶段浏览器实测
   （三栏布局/neighbors 查询高亮 dim 反馈/力场切片/4628 节点静态聚类渲染均有效，截图见会话记录），
   生产实现按此直译（力场参数逐项一致有单测钉死）。
2. **主题合规**：graph-canvas.tsx grep 六位 hex 零命中（nodePalette 全取 themes[theme]）；ops-dashboard
   图卡与图谱页复用主题 token 类名——tsc/lint/vitest 170 用例含六键文案与三态版位断言。
3. **布局降级**：>200 节点静态布局（类型分环同心圆）确定性断言（graph-canvas.test.ts：201 节点用例）；
   lite 簇摆放确定性断言（乱序归一用例）。

## 部署后截图清单（待补，对应 verify-e2e.md 清单）

- [ ] 图谱页默认 orphans 视图（blue/ai-native/dark 三主题各一张）
- [ ] lite 总览簇气泡与代表节点
- [ ] OpsDashboard 图·孤儿/图·悬空卡与点开清单
- [ ] 六键 unavailable 降级卡（unbound 态）
