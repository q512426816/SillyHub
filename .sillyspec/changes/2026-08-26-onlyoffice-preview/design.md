---
author: WhaleFall
created_at: 2026-08-26 09:10:00
updated_at: 2026-08-26 09:10:00
scale: large
modules: [frontend_components, backend_preview_office, deploy]
---

# 设计文档（Design）— OnlyOffice 高保真 Office 预览

> 注：sillyspec CLI 3.27.5 全阶段启动崩溃（docs/sillyspec/2026-08-25-quick-done-missing-export.md），
> 本四件套按流程文档规范手工产出。

## 1. 背景

SheetJS/docx-preview 纯前端渲染只提供"数据级"预览（无原文件样式）；用户实测绩效考核
报表 xls 后要求样式还原（ql-20260825-005/006 反馈链）。调研（见 decisions.md D-001 调研
记录）确定自托管 OnlyOffice DocumentServer（CE，AGPL）为唯一免费高保真方案，用户拍板
方案 A 并确认风险（内存硬阻塞 Docker VM 3.8GB→需调 8GB，部署时处理）。

## 2. 设计目标

1. Office 家族（docx/xlsx/pptx/**doc/xls/ppt 旧格式**）在线预览**高保真还原**（列宽/
   颜色/合并/图表/冻结窗格）；
2. 只读预览（DS 编辑器 mode=view），在线编辑为非目标；
3. **降级链**：DS 未配置/不可用/加载失败 → 自动回落现有渲染器（docx→docx-preview、
   xlsx/xls→SheetJS、ppt→fallback 下载），预览功能永不因 DS 故障整体不可用；
4. 文件访问安全：DS 拉文件走一次性短时令牌（无 JWT 头），防未授权拉取与重放；
5. 前端零构建配置：DS 公网地址经 backend config 端点下发（.env 改地址免重新 build）。

## 3. 非目标

- 在线编辑/协同（DS 编辑模式、callback 保存均不启用）
- PDF/图片/md 换 DS（现有渲染器已达标，不动）
- 移动端 m/ 适配
- 文档缓存优化（doc_key 每次随机，DS 每次重新拉文件——内部使用规模下换实现简单）
- 对外开放（AGPL 边界：PPM 已上线，若预览能力将来暴露给外部客户需法务复核——风险登记 R-05）

## 4. 总体方案

```
浏览器                                   backend(FastAPI)                onlyoffice 容器(DS CE)
  │ 点击 office 文件预览                        │                              │
  │──GET /api/preview/office-config──────────▶│ 校验归属(JWT)+取 object_key   │
  │                                           │ 签一次性 file token(HS256,    │
  │                                           │  5min, redis jti 防重放)      │
  │                                           │ 组 editor config 并以 DS      │
  │◀──{ds_url, config_jwt}───────────────────│  JWT_SECRET 签名              │
  │                                           │                              │
  │──GET {ds}/web-apps/.../api.js──────────────────────────────────────────▶│
  │  <OnlyofficePreviewer> 初始化 DocEditor    │                              │
  │──────DS 浏览器侧加载编辑器 UI───────────────────────────────────────────▶│
  │                                           │◀─GET /api/preview/file/{tk}──│ (容器内网)
  │                                           │ 校验 token→流式返回对象──────▶│
  │◀══════ DS iframe 高保真渲染 ════════════════════════════════════════════│
```

**降级链**（前端）：office 文件 → 尝试 OnlyOffice（config 端点 503/api.js 加载失败/
DocEditor onError → 任一触发）→ 回落 registry 现有 key 渲染（docx/xlsx/…）。

## 5. 文件变更清单

| 操作 | 文件 | 说明 |
|---|---|---|
| 新增 | deploy/docker-compose.yml（修改） | +`onlyoffice` 服务：`onlyoffice/documentserver:9`、JWT_ENABLED=true+JWT_SECRET、外连现有 PG（新库 onlyoffice，DB_HOST=postgres）、内置 RabbitMQ（all-in-one 模式）、mem_limit 2.5g、healthcheck、端口 `127.0.0.1:${ONLYOFFICE_PORT:-8700}:80` |
| 新增 | deploy/.env.example（修改） | +ONLYOFFICE_PORT、ONLYOFFICE_PUBLIC_URL（浏览器可达地址，如 http://10.x.x.x:8700）、ONLYOFFICE_JWT_SECRET |
| 新增 | backend/app/modules/preview_office/{__init__,router,service,model}.py | ①`GET /api/preview/office-config?source=session_attachment\|file&id=`（JWT 鉴权：归属校验→签 file token→组 config 并 DS 签名→返回 ds_url+config_jwt）；②`GET /api/preview/file/{token}`（无鉴权：HS256 校验+redis jti 一次性消费+TTL 5min→流式返回对象，inline disposition） |
| 新增 | backend/app/modules/preview_office/tests/ | token 签发/一次性/过期/归属 404、config 签名结构、DS 未启用 503 |
| 修改 | backend/app/core/config.py | +onlyoffice_enabled/public_url/internal_jwt_secret/file_token_ttl |
| 修改 | backend/app/main.py | 挂载 preview_office router |
| 新增 | frontend/src/components/files/previewers/onlyoffice-previewer.tsx | 动态 script 加载 `{ds_url}/web-apps/apps/api/documents/api.js` → `new DocsAPI.DocEditor(el, config_jwt)`（只读）；加载/初始化失败回调 → `onFallback()` |
| 修改 | frontend/src/components/files/file-preview-modal.tsx | office 家族（docx/xlsx/doc/xls/ppt/pptx/ppt? 见 registry 扩展）预取 office-config：成功→OnlyofficePreviewer；失败→现有 RENDERER_MAP 渲染（降级链） |
| 修改 | frontend/src/components/files/preview-registry.ts | +`officeOnlyFormats`（doc/ppt/pptx——仅 DS 能渲染、无本地渲染器的格式集合，降级时 fallback） |
| 新增 | frontend/src/components/files/__tests__/onlyoffice-*.test.tsx | config 端点 mock 两态（成功渲染 DocEditor / 503 降级到本地渲染器）；pptx 走 DS 成功路径 |
| 新增 | 本目录 design/proposal/requirements/tasks/plan | 手工四件套 |

**数据流标注**：`editor_config_jwt` producer=backend service（python-jose HS256，
ONLYOFFICE_JWT_SECRET）→ consumer=DS 容器（JWT 校验）；`file_token` producer=同端点 →
consumer=`GET /api/preview/file/{token}`（DS 内网拉取）。OpenAPI 新增两端点 → 需
`pnpm gen:types` 成对提交。

## 6. 接口定义

```python
# GET /api/preview/office-config（JWT）→ 200 OfficePreviewConfigResp | 503（DS 未启用）
class OfficePreviewConfigResp(BaseModel):
    ds_url: str            # 浏览器可达 DS 地址（.env 注入，前端零配置）
    config_jwt: str        # DS 编辑器配置签名（含 document.url=一次性文件地址）
# GET /api/preview/file/{token}（无鉴权）→ 200 文件流 | 401/404/410
```

```ts
// onlyoffice-previewer.tsx
export function OnlyofficePreviewer(props: PreviewerProps & {
  config: { ds_url: string; config_jwt: string };
  onFallback: () => void;   // 任何失败 → 上层切回本地渲染器
}): JSX.Element;
```

## 7. 数据模型

无表结构变更（file token 用 redis jti 键，TTL 与令牌同步）；PG 新增 onlyoffice 空库
（DS 自建表，与平台库隔离）。

## 8. 兼容策略

- ONLYOFFICE_ENABLED=false（默认）→ config 端点 503 → 前端降级链生效 → 行为与现状
  逐字节一致（未部署 DS 的环境零影响）；
- 现有六渲染器、registry 匹配优先级、三入口全部不动（DS 是前置尝试层，非替换）。

## 9. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | ~~Docker VM 内存不足~~ | ~~P0~~ | **已消除（D-006 复用 bsp-onlyoffice，DS 内存 1.24GB 已含在现有额度内）** |
| R-02 | file token 重放 | P1 | 5min TTL + redis jti 一次性消费 + HS256 签名绑定 object_key |
| R-03 | 局域网 IP 变更致 ds_url 失效 | P1 | ds_url 经 config 端点下发（.env 改即生效，免重 build） |
| R-04 | DS 容器故障拖垮预览 | P1 | 全链路降级（端点 503/api.js 失败/onError 三层兜底） |
| R-05 | AGPL 对外边界 | P2 | 内部使用合规；对外（PPM 暴露预览）前需法务复核——文档登记 |
| R-06 | DS 大版本升级 breaking | P2 | 镜像 tag 由 bsp 侧管理（latest，升级需联测）；升级走变更流程 |
| R-07 | 共用 bsp 实例：bsp 停机/升级波及本平台预览 | P1 | 三层降级链兜底（D-007）；dev 弱密钥建议后续两项目同步换强密钥 |

## 10. 决策追踪

见 decisions.md（D-001 方案选型调研结论、D-002 一次性令牌 vs presigned、D-03 免 npm
包、D-04 doc_key 随机不缓存）。

## 11. 自审

- 章节齐全；生命周期：无状态机变更（新增幂等只读+一次性令牌端点，契约表——
  | GET office-config | 浏览器 | backend | JWT | 无 |
  | GET file/{token} | DS | backend | 一次性 token | redis jti 消费 |）；
- 兼容：默认关闭=现状零变化；YAGNI：不做编辑/缓存/移动端；类型：OpenAPI 变更→gen:types。
