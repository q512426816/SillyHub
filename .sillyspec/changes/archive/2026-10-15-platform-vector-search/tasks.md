---
author: flow-machine-draft
created_at: 2026-10-15T03:25:03.698Z
---
# 任务注册表（Tasks）— 2026-10-15-platform-vector-search

- [x] task-01: 端点契约逐字段对齐 CLI：Bearer shpsync 鉴权（无 token 401、非 shpsync 凭据 403）、Body {query,limit}、200 {ok,results:[{spec_path:'knowledge/decisions/x.md',anchor:'D-xxx@vN',change,score}]}
- [x] task-02: 索引懒构建+指纹失效（文件增删改后重建），余弦排序 top-k、limit 钳位
- [x] task-03: fastembed 缺席/模型初始化失败 → 200 {ok,results:[],model_ready:false,reason} 不 5xx 不阻塞启动
- [x] task-04: 单测：解析/指纹失效/余弦排序/fake embedder 端点契约/401/403 全绿
