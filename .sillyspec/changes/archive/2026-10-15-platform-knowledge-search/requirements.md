---
author: qinyi
created_at: 2026-10-15 15:59:42
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户（workspace 成员） | 持 `knowledge:read` 权限浏览知识库页；可能另持 `scan-docs:read` 查看模块文档 |
| 平台管理员 | `is_platform_admin` 短路，拥有全部权限（含 `scan-docs:read`），搜索结果 MUST 全量 |

## 功能需求

### FR-01: 搜索入口与语料覆盖
覆盖决策：D-001@v1, D-002@v1
Given 用户打开某工作区知识库页，spec 树含 knowledge/ 与 docs/ 下 md 文档
When 在左栏搜索框输入关键词并停止输入（debounce 300ms）
Then 前端 MUST 请求后端搜索端点，后端 MUST 在 `spec_root/knowledge/**` 与 `spec_root/docs/**`（排除 INDEX.md）语料内检索，返回按匹配度排序的结果列表；结果条数 MUST 受 limit 钳位（默认 20，上限 50）

### FR-02: 结果形态与片段高亮
覆盖决策：D-003@v1, D-006@v1
Given 检索返回非空结果
When 渲染结果列表（替换文件树视图）
Then 每条 MUST 含：来源徽章（决策/需求/知识/模块文档等，由 kind 派生）、标题（条目标题或标题块）、`spec_path`、匹配上下文片段（词面命中位置 ±120 字符）、匹配度分数；片段中 query 子串 MUST 以高亮样式（`<mark>`，brand 阶）呈现；清除搜索词后 MUST 恢复文件树

### FR-03: 双路召回与语义降级
覆盖决策：D-004@v1
Given 搜索请求到达后端
When 语义 embedder 可用
Then 结果 MUST 为词面匹配与向量语义召回的融合排序（`0.6*向量 + 0.4*词面`），且精确编号/文件名命中（title/path 词面命中）经保底 0.9 稳居前排——保底为下界，可断言的验收形态是相对排序：查询词等于某条目编号时该条目 MUST rank=1（同分按词面命中 tie-break；数值调参须与 design R-03 三方同步）
When embedder 不可用（fastembed 缺席/模型加载失败）
Then 端点 MUST fail-soft 返回纯词面结果 + `model_ready=false`（含 reason），HTTP MUST NOT 报 5xx；前端 MUST 显示黄色降级提示条「语义模型暂不可用，当前为关键词匹配结果」

### FR-04: 搜索结果的权限边界（按权限过滤语料）
覆盖决策：D-005@v1
Given 调用者持 `knowledge:read`
When 调用搜索端点且调用者无 `scan-docs:read`
Then 响应结果 MUST NOT 含 `spec_path` 以 `docs/` 开头的项（服务端过滤，先取 3×limit 候选再过滤截断）；知识类结果 MUST 照常返回
Given 调用者无 `knowledge:read`
Then 端点 MUST 返回 403；未知 workspace MUST 返回 404

### FR-05: 结果跳转
覆盖决策：D-006@v1
Given 搜索结果列表已渲染
When 点击 `spec_path` 以 `knowledge/` 开头的结果
Then 右栏 MUST 就地加载该文件并滚动定位到条目锚点——经既有 `?file=&anchor=` URL 深链通路（`router.push` 更新 URL，可分享、刷新保持定位；MUST NOT 新增第二条选中通路）
When 点击 `spec_path` 以 `docs/` 开头的结果
Then MUST 跳转 `/workspaces/{id}/scan-docs?path=<path>`，模块文档页列表就绪后经既有 requestDoc 通路选中该文档；`?path=` 深链 MUST 支持刷新与分享；目标文件尚未同步时 MUST 静默留在列表态（不报错、不提示、不重试请求），待列表刷新出现后自动选中

### FR-06: 索引自愈
覆盖决策：D-007@v1
Given 索引已构建且 spec 语料文件发生增/删/改
When 下一次搜索请求到达
Then 文件集指纹（path/mtime_ns/size）比对失配时索引 MUST 自动重建，MUST NOT 要求重启进程；进程重启后首次查询 MUST 按需重建（缓存命中与否 MUST NOT 影响正确性）

## 非功能需求
- 兼容性：MUST 兼容 Windows/Linux/macOS 三平台（路径处理统一 POSIX 形态）；fastembed 缺席时服务 MUST 可启动可搜索（fail-soft）；MUST NOT 改动 CLI 向量端点与既有知识库接口契约。
- 性能：索引已构建时单次查询 SHOULD <1s（embed query 毫秒级 + 余弦毫秒级）；首查含索引构建，前端 SHOULD 展示构建中 loading 文案（实测校准，见 design R-01）。
- 安全：无权限语料 MUST NOT 出现在响应中（端点层过滤，MUST NOT 依赖前端隐藏）；MUST NOT 泄露其他 workspace 内容（语料根按 workspace 解析）。
- 可测试：语料解析/切块/打分 MUST 为可独立测试的纯函数结构；embedder MUST 支持测试注入 fake（fastembed 不进测试依赖）。

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 新建用户侧端点（不复用 CLI 端点的通道/语料约束） |
| D-002@v1 | FR-01 | 语料边界 = knowledge/ + docs/ 全域，不含 changes/ |
| D-003@v1 | FR-01/FR-02 | 三档切块与条目锚点，锚点供 FR-05 定位 |
| D-004@v1 | FR-03 | 词面+向量融合与 fail-soft 降级 |
| D-005@v1 | FR-04 | KNOWLEDGE_READ 门控 + SCAN_DOCS_READ 结果过滤 |
| D-006@v1 | FR-02/FR-05 | 交互形态：左栏搜索框 + 结果面板 + 双落点跳转 |
| D-007@v1 | FR-06 | 懒构建 + 指纹失效；独立索引 |
| D-008@v1 | FR-01~FR-06 | 方案 A 总纲（本需求集即其行为化） |
| D-009@v1 | FR-01/FR-04 | 落选 B 的防复潮边界：CLI 端点零改动（非功能-兼容性） |
| D-010@v1 | FR-06 | 落选 C 的防复潮边界：无 DB 表/无同步链路 |

## 剩余风险
- design R-01（首查索引构建耗时未实测）/R-03（融合权重初值需实测校准）为已知开口，execute 阶段实测校准；不影响本需求集的可验证性。

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-06: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
