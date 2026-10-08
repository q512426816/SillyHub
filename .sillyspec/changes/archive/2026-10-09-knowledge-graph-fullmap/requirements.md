---
author: qinyi
created_at: 2026-10-09 00:35:00
---
# 需求规格（Requirements）— 2026-10-09-knowledge-graph-fullmap

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 图谱页默认看全图星空总览，点节点下钻切片 |
| 绑定 daemon | 执行 `sillyspec knowledge graph dump --layout --json` |
| sillyspec CLI | dump 子命令：全量图+预计算确定性坐标 |

## 功能需求

### FR-01: CLI dump 子命令
覆盖决策：D-002@v1, D-003@v1
Given specRoot 全图（本仓真图 5812 节点量级）
When `sillyspec knowledge graph dump --layout --json`
Then 输出 `{ok, nodes:[{id,type,label,x,y}], edges:[{s,t,type,strength}], stats}`；坐标 MUST 确定性（同输入两次调用逐位一致）；stats 与 summary 子命令同源；缺 --layout 时 MUST 回 usage 错（dump 无 layout 无意义）；坐标计算 MUST 内存现算不落盘

### FR-02: daemon dump 白名单
覆盖决策：D-002@v1
Given daemon 收到 knowledge.graph RPC sub=dump
Then 白名单 MUST 放行 dump；layout MUST 为 true（false/缺省回 validation_rejected）；回包 MUST 全量不裁剪；消毒/超时/回码沿既有 graph 分支零变化

### FR-03: backend dump 端点与压缩
覆盖决策：D-002@v1
Given 可用态
When `GET /api/workspaces/{ws}/knowledge/graph/dump`（KNOWLEDGE_READ，注册在 {filename:path} 通配前）
Then 信封六键同族，data={nodes,edges,stats}；GZipMiddleware(minimum_size=1024) 全站启用，带 Accept-Encoding: gzip 的请求响应 MUST Content-Encoding: gzip；SSE/WS 等既有流式面 MUST 零回归

### FR-04: 前端默认全图与下钻
覆盖决策：D-001@v1, D-002@v1
Given 图谱页可用态且 dump 在场
When 首载
Then 默认加载 dump 并静态渲染全图星空（不启力场；k<0.5 不画边；标签只在大半径类型或 k>1.35）；点任意节点 MUST 切「查询切片」模式并以该节点发起 neighbors（力场）；胶囊「全图/查询切片」手动切换；dump 数据 staleTime 5min
Given dump 不可用（cli_feature_missing:dump 或旧 daemon）
Then 全图胶囊隐藏、默认回退 orphans 视图，五查询/图卡/补全零影响

#### 场景：lite 移除
Given 任意态
Then lite 渲染分支与胶囊 MUST 移除；liteClusterLayout 纯函数及其单测保留（无 UI 引用，注释标注保留原因）

### FR-05: 全图渲染性能
覆盖决策：D-002@v1
Given 5812 节点静态全图
When 缩放平移交互
Then 帧渲染 MUST 无力场计算（恒静态）；边绘制按缩放阈值裁剪；交互帧脏标记重绘；肉眼流畅（无逐帧全量重算）

## 非功能需求

### NFR-01 性能
dump gzip ≤300KB（5812 节点量级）；WS 单帧 ≤2MB（16MB 上限 8× 余量，实测钉）。

### NFR-02 兼容
GZip 协商标准行为；旧 CLI/旧 daemon 探测降级链完整；既有测试零回归。

### NFR-03 主题与文案
全图渲染三主题 token 零硬编码色；全中文文案。

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
