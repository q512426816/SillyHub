---
author: qinyi
created_at: 2026-10-09 01:47:00
---
# UI 视觉证据（Visual Evidence）— 2026-10-09-knowledge-graph-fullmap

## 执行期实测（真实环境截图，存 e2e-screenshots/）

1. **01-全图星空默认视图.png**：进页默认=全图静态渲染——星系式聚类分布（多个大小簇团+疏密对比，原型同款视觉）；「全图」胶囊激活；右栏统计卡（5855 节点/10464 边/四计数/byType）与后端 dump 一致；mode-chip「全图 5855 节点 · 静态」。
2. **02-点节点下钻切片.png**：点大簇节点 → 自动切「查询切片」+ neighbors 发起（FR-auto-frontend-011 一跳力场切片）+ chip/右栏详情全联动——D-001 下钻语义兑现。
3. 主题合规：full 分支沿 nodePalette 三主题 token（tsc/lint+169 前端用例含渲染断言）；对比基准=归档原型全图模式（PHYS=false 静态+标签分级），布局常量逐项同值（Grill 复审核对）。
