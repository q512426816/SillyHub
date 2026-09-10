---
author: qinyi
created_at: 2026-09-10 15:29:47
scale: large
risk_level: unit-sufficient
---

<!-- risk_level 说明：CLI 关键词命中 daemon/session/claim 系误伤——「daemon」指后端
     group chat 模块路径 app/modules/daemon/group/（纯读取路径构造点），非 Node 守护
     进程；「session」仅指前端 session store 展示接线。本变更是静态字段读写 + API
     端点 + UI 接线，无生命周期/状态机/心跳/租约语义（生命周期契约表已豁免），
     FastAPI 异步测试（sqlite create_all）+ 前端组件测试即可充分验证。 -->

# 设计文档（Design）— 2026-09-10-account-avatar-upload

## 背景

个人中心（桌面 `/account`、移动 `/m/account`）目前没有头像功能：桌面页仅一张修改密码卡片；移动页头像区是首字母占位（displayName 首字）。顶栏用户区、群聊中用户成员位置、1:1 会话中自己的气泡同样都是首字占位。用户需要能在个人中心替换自己的头像，且手机端也能操作（线上地址 https://crrcdt.ppdmq.top/account）。

平台已有一套完整且经过验证的头像基础设施（quick 群成员头像 / agent 头像沿用）：文件中心上传端点（`POST /api/file/upload`，multipart + MinIO + owner_type 维度）、前端上传封装（`uploadFile`，XHR + 401 刷新重试）、头像渲染 hook（`useAvatarSrc`：文件中心 URL 带 token 取 blob → objectURL，外链直用，失败回退首字）、上传控件（`GroupMemberAvatarUpload`：预览 + 上传 + 恢复默认）。本变更把「平台用户」接入同一套体系。

## 设计目标

1. 用户可在桌面 `/account` 与移动 `/m/account` 上传/更换/清除自己的头像（选图直接上传，无裁剪交互，圆形样式自动裁切显示）。
2. 头像在五处展示：桌面个人中心、移动个人中心、桌面顶栏用户区、群聊中用户成员位置、1:1 会话中自己的消息气泡。
3. 与 agent/群成员头像同构：`users.avatar` 存文件中心 URL（`/api/file/{id}`），上传走现有端点，渲染复用现有 hook。
4. 双主题（blue / ai-native）与移动端样式规范完全沿用现有体系，不引入新视觉。

## 非目标

- PPM 个人工作台 `WorkbenchProfile.avatar_text` 维持首字占位（D-003：PPM 已上线模块不动）。
- 不做图片裁剪器（用户已确认直接上传）。
- 不做外链 URL 手动输入入口（字段层面与群成员一致可存外链值，但 UI 只提供上传）。
- 不做群内用户成员的独立头像覆盖 UI（群内 avatar 列对 user 成员继续由平台头像回落驱动）。
- 不做头像审核/裁剪压缩/尺寸限制专项（沿用文件中心现有大小与类型白名单）。

## 拆分判断

单变更即可：功能内聚（一个字段 + 一个端点 + 展示点接线），无跨团队并行面。后端（auth 模块 + agent 模块回落解析）与前端（store + 两页 + 三展示点）在同一个变更内按 Wave 排序：后端先行（schema/端点/迁移），前端依赖 gen:types 之后接线。

## 总体方案

### Wave 1：后端

1. `users.avatar` 列（String(512) nullable）+ alembic 迁移。
2. `UserRead` 增加 `avatar: str | None` → `GET /api/auth/me` 自动带出（from_attributes）。
3. 新端点 `PATCH /api/auth/me/avatar`（登录态，body `UpdateMyAvatarRequest{avatar: str | None}`，语义对齐群成员惯例：值=设置、空串=清除置 NULL、None=不改；返回更新后 `UserRead`）。更新逻辑写入 `auth/service.py`（与 change_password 同层）。
4. 群聊回落解析（D-002）：`daemon/group` 模块构造 `GroupMemberRead` 的读取路径上，user 成员 `avatar = member.avatar or user.avatar`（群内自定义优先；NULL/空串回落平台头像）。真实构造点（已核对源码）：`daemon/group/service/helpers.py:701` `_to_read`（群读主路径，批量）、`daemon/group/service/members.py:512/673`（加成员/改成员返回）。实现约束：`_to_read` 为同步函数不能直查 users 表——在异步调用方批量预取 `user_id → avatar` 映射后传入（或对 `read.members` 后处理），select in (user 成员 id 集)，一次查询。`daemon/group/router.py:379/407` 两个端点返回值来自上述 service 构造，无需单独改。

### Wave 2：前端

1. `SessionUser` 增加 `avatar?: string | null`；`lib/auth` 增加 `updateMyAvatar()`（apiFetch PATCH，成功后 `setUser` 写回 store；多标签页同步走现有 storage 事件机制，零新增）。
2. `GroupMemberAvatarUpload` 增加可选 `ownerType` prop（默认维持 `group_member_avatar`，向后兼容），桌面/移动个人中心复用该控件完成「预览 + 上传 + 恢复默认」。
3. 桌面 `/account`：修改密码卡片上方新增「个人资料」卡片（头像预览 + 更换头像 + 恢复默认按钮，写回后端 + store）。
4. 移动 `/m/account`：头像整块可点上传（相机角标提示可换），有自定义头像时提供恢复默认小入口；上传中/失败态提示。
5. `TopBar` 增加 `avatar` prop（app-shell 从 session user 取），shadcn Avatar 内嵌头像图（`useAvatarSrc` blob 拉取），无图维持现状首字。
6. 会话时间线（turn-timeline）用户气泡：`sender.me` 时传自己的头像（`ChatMessageAvatar` 已支持 avatar prop，接线即可）。
7. `pnpm gen:types` 重新生成 `api-types.ts` + 提交 `openapi.json`。

### Wave 3：测试与验收

后端：新端点四态（设置/清除/未登录 401/超长 422）、`UserRead.avatar` 带出、群成员 user 侧回落解析用例。前端：桌面/移动 account 上传流程（mock 上传与 PATCH 接口）、TopBar 头像渲染。仅跑相关测试（CLAUDE.md 规则 0）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/auth/model.py | User 增加 avatar 列（String 512 nullable） |
| 新增 | NEW:backend/migrations/versions/2026xxxx_users_avatar.py | alembic 加列迁移（revision 执行时按链头生成） |
| 修改 | backend/app/modules/auth/schema.py | UserRead.avatar；新增 UpdateMyAvatarRequest |
| 修改 | backend/app/modules/auth/router.py | PATCH /api/auth/me/avatar 端点 |
| 修改 | backend/app/modules/auth/service.py | update_my_avatar 业务逻辑（producer：写 users.avatar） |
| 修改 | backend/app/modules/daemon/group/service/helpers.py | `_to_read` 群读主路径：user 成员 avatar 回落解析（消费预取映射） |
| 修改 | backend/app/modules/daemon/group/service/members.py | 加/改成员返回构造点：user 成员 avatar 回落解析 |
| 修改 | frontend/src/stores/session.ts | SessionUser.avatar 字段 |
| 修改 | frontend/src/lib/auth.ts | updateMyAvatar() 封装 + store 写回 |
| 修改 | frontend/src/components/group-chat/group-member-avatar.tsx | GroupMemberAvatarUpload 增加可选 ownerType prop |
| 修改 | frontend/src/app/(dashboard)/account/page.tsx | 个人资料卡片（头像 + 上传/恢复默认） |
| 修改 | frontend/src/app/m/account/page.tsx | 头像可点上传 + 恢复默认入口 |
| 修改 | frontend/src/components/app-shell.tsx | 取 session user.avatar 传 TopBar |
| 修改 | frontend/src/components/top-bar.tsx | avatar prop + 头像图渲染 |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | 用户气泡 sender.me 传头像 |
| 生成 | frontend/src/lib/api-types.ts + backend/openapi.json | pnpm gen:types |
| 新增 | NEW:backend/tests/modules/auth/test_my_avatar.py | PATCH /me/avatar 四态 + 超长 422（与 test_change_password.py 同目录惯例） |
| 新增 | NEW:backend/tests/modules/daemon/test_group_member_avatar_fallback.py | user 成员回落解析（daemon 测试目录现有平铺文件惯例） |
| 修改 | frontend/src/app/(dashboard)/account/page.test.tsx | 桌面个人资料卡片上传流程用例 |
| 新增 | NEW:frontend/src/app/m/account/page.test.tsx | 移动头像上传流程用例 |
| 新增 | NEW:frontend/src/components/__tests__/top-bar-avatar.test.tsx | TopBar 头像渲染/首字回退用例 |

## 接口定义

### 后端

```python
# app/modules/auth/schema.py
class UpdateMyAvatarRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    avatar: str | None = Field(default=None, max_length=512,
        description="头像 URL（文件中心 /api/file/{id}）；值=设置，''=清除，None=不改")

class UserRead(BaseModel):  # 追加字段
    avatar: str | None = None

# app/modules/auth/router.py
@router.patch("/me/avatar", response_model=UserRead)
async def update_my_avatar(
    body: UpdateMyAvatarRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    session: AsyncSessionDep,
) -> UserRead: ...
```

### 前端

```ts
// lib/auth.ts
export async function updateMyAvatar(avatar: string | null): Promise<void>;
// avatar：新 URL 或 null（清除）。注意：PATCH 响应为 UserRead（snake_case），
// 不能直接 setUser——复用 fetchMe 既有的 snake→camel 映射（或 PATCH 成功后
// 直接重跑 fetchMe() 取规范 user 再 setUser，实现取后者更不易漂移）。
// GroupMemberAvatarUpload 新增可选 prop（默认值不变，既有调用零改动）
ownerType?: string;  // 默认 GROUP_MEMBER_AVATAR_OWNER_TYPE；个人中心传 "user_avatar"
```

存储语义备注（审查 C-08）：本端点自身语义自洽——空串=清除**置 NULL**（users.avatar 列存 NULL）；群成员 PATCH 的清除是原样存空串 `""`（members.py:348 只判 `is not None`），两者存储行为不同但可见语义一致（D-002 读取端 `member.avatar or user.avatar` 对 NULL/"" 同样回落）。

## 生命周期契约表

本变更不涉及生命周期契约（无 session/lease/agent_run/daemon/lifecycle/state transition/claim/heartbeat 语义；仅静态字段读写与展示接线）。

## 数据模型

`users` 表新增一列：

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| avatar | VARCHAR(512) | NULL | 头像 URL：`/api/file/{id}`（文件中心）或 http(s) 外链；NULL=未设置（前端回退首字） |

alembic 迁移：`add_column users.avatar`（nullable，无默认值，无索引）。其余表零改动；`agent_group_members.avatar` 既有列语义不变（仅读取时对 user 成员做平台头像回落）。

## 兼容策略（brownfield 必填）

- 未设置头像（avatar=NULL）时所有展示点行为与现状完全一致（首字回退），老数据零影响。
- `GET /api/auth/me` 响应新增 `avatar` 字段：前端 `SessionUser` 为可选字段，旧 localStorage 里已持久化的 user 对象缺该字段按 undefined 处理（storage 回放「只回放存在的字段」机制天然兼容）。
- 群成员 avatar 回落是纯读取端增强：群内自定义头像（member.avatar 有值）优先级不变，仅空值时多一层平台头像来源；`PATCH 群成员 avatar` 的 None=不改、空串=清除语义不变。
- 上传端点/文件中心零改动，仅新增一种 owner_type 取值（`user_avatar`，字符串维度无枚举约束）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 头像 blob 拉取（带 token fetch）在高频渲染点（群聊消息）造成请求放大 | P2 | `useAvatarSrc` 为既有管线，群聊 agent 成员头像已按此运行无性能问题；浏览器对同 URL blob 有常规并发控制，且单页头像数量有限 |
| R-02 | 旧会话（localStorage 持久化 user）无 avatar 字段导致展示点 undefined | P2 | 字段可选 + 现状首字回退天然兼容；下次 /me 刷新自动补齐 |
| R-03 | GroupMemberRead 构造点回落解析遗漏：`_to_read` 为同步函数不能直查 users 表，需异步调用方批量预取 `user_id→avatar` 映射传入（Grill C-06/C-07 已核：主路径 helpers.py:701 + members.py:512/673，router 两端点复用 service 构造） | P1 | 设计已给出预取映射方案（select in user 成员 id 集，一次查询）；执行期以 grep GroupMemberRead 复核全部构造点；测试覆盖群读主路径与加/改成员返回 |
| R-04 | UI 原型跳过（分级：既有页面增量卡片/头像位，沿用 FRONTEND_PAGE_STYLE 双主题体系，无新页面无新视觉体系） | P2 | 实现严格照规范（brand-* 语义阶 + 主题 token + 阴影 token）；verify 阶段人工过双主题截图 |
| R-05 | 用户上传超大图片（文件中心默认上限内的大图）影响加载 | P3 | 沿用文件中心现有大小/类型白名单约束；后续需要再单独立压缩专项（非目标） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 总体方案 Wave 1/2（存储与上传管线）、数据模型、接口定义 | 已确认（用户选定方案 A） |
| D-002@v1 | 总体方案 Wave 1 第 4 条、兼容策略第 3 条、R-03 | 已确认（代码依据落盘） |
| D-003@v1 | 非目标第 1 条 | 已确认（用户圈定范围） |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@v1（D-001/D-002/D-003 均在决策追踪表）
- [x] 不涉及生命周期关键词——「生命周期契约表」节已写豁免短语
- [x] UI 原型分级核对：跳过，理由记入 R-04
- [x] 无「⚠️ 自审存疑」项（三个决策均已获用户/代码依据确认）
