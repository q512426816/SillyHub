---
author: flow-machine-draft
created_at: 2026-10-15T03:25:03.698Z
---
# 提案书（Proposal）— 2026-10-15-platform-vector-search

## 动机

任务原话转写：效果评估清偿批 B1 平台面拍板（本地小模型方案）：CLI 向量召回层 2026-09-29 发布即对接本端点，平台从未实现（404 半个月实证），CLI 侧已收紧为显式开启并 404 短路。本变更补齐平台端：POST /api/spec/knowledge/vector-search（shpsync workspace token 鉴权——token 派生 workspace，契约同 sillyspec src/knowledge-vector.js 文件头），语料=workspace spec 树 knowledge/decisions/*.md 条目（id/变更/理由），embedding 用 fastembed 本地小模型（bgе-small-zh-v1.5 ONNX ~90MB 镜像内，零 key 零 API 零持续成本），索引进程内按 decisions 文件集指纹（path+mtime+size）懒构建缓存，查询=查询向量与语料余弦 top-k。模型不可用/依赖缺席 fail-soft 返回空 results（CLI 静默降级本地层），lazy import 不阻塞应用启动。设计偏差：提案里的 daemon sync 挂点灌索引改为查询时懒构建（语料量级 700-2400 条秒级，免 daemon 改动）。

成功标准：
- 端点契约逐字段对齐 CLI：Bearer shpsync 鉴权（无 token 401、非 shpsync 凭据 403）、Body {query,limit}、200 {ok,results:[{spec_path:'knowledge/decisions/x.md',anchor:'D-xxx@vN',change,score}]}
- 索引懒构建+指纹失效（文件增删改后重建），余弦排序 top-k、limit 钳位
- fastembed 缺席/模型初始化失败 → 200 {ok,results:[],model_ready:false,reason} 不 5xx 不阻塞启动
- 单测：解析/指纹失效/余弦排序/fake embedder 端点契约/401/403 全绿

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 端点契约逐字段对齐 CLI：Bearer shpsync 鉴权（无 token 401、非 shpsync 凭据 403）、Body {query,limit}、200 {ok,results:[{spec_path:'knowledge/decisions/x.md',anchor:'D-xxx@vN',change,score}]}
2. 索引懒构建+指纹失效（文件增删改后重建），余弦排序 top-k、limit 钳位
3. fastembed 缺席/模型初始化失败 → 200 {ok,results:[],model_ready:false,reason} 不 5xx 不阻塞启动
4. 单测：解析/指纹失效/余弦排序/fake embedder 端点契约/401/403 全绿

## 成功标准（可验证）

1. 端点契约逐字段对齐 CLI：Bearer shpsync 鉴权（无 token 401、非 shpsync 凭据 403）、Body {query,limit}、200 {ok,results:[{spec_path:'knowledge/decisions/x.md',anchor:'D-xxx@vN',change,score}]}
2. 索引懒构建+指纹失效（文件增删改后重建），余弦排序 top-k、limit 钳位
3. fastembed 缺席/模型初始化失败 → 200 {ok,results:[],model_ready:false,reason} 不 5xx 不阻塞启动
4. 单测：解析/指纹失效/余弦排序/fake embedder 端点契约/401/403 全绿
