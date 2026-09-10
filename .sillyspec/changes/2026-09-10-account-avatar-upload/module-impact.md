# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend:auth | backend/app/modules/auth/{model,schema,router,service}.py | 数据结构变更（users.avatar 列+迁移）+ 接口变更（PATCH /api/auth/me/avatar + UserRead.avatar）+ 逻辑变更（update_my_avatar 三态） | 否（review.json pass + 7 用例） |
| backend:daemon(group 子域) | backend/app/modules/daemon/group/service/{helpers,members,crud,__init__}.py | 逻辑变更（user 成员 avatar 回落解析，读取端语义增强） | 否（16 用例 + 50 既有零回归） |
| frontend:stores | frontend/src/stores/session.ts | 数据结构变更（SessionUser.avatar 可选字段，向后兼容） | 否 |
| frontend:lib | frontend/src/lib/auth.ts、frontend/src/lib/api-types.ts、backend/openapi.json | 接口变更（updateMyAvatar 新函数 + fetchMe 映射补字段 + gen:types 产物） | 否（tsc+11 用例） |
| frontend:components | group-member-avatar.tsx、app-shell.tsx、top-bar.tsx、turn-timeline.tsx | 接口变更（ownerType/avatar 可选 prop，默认行为不变）+ 逻辑变更（blob 头像渲染/气泡接线） | 否（74+9+241 用例零回归） |
| frontend:app | (dashboard)/account/page.tsx、m/account/page.tsx | 新增（个人资料卡片/移动头像上传） | 否（9+5 用例） |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `backend/migrations/versions/20260910160000_users_avatar.py` —— 游离归因：migrations 目录不在 module-map paths（auth 模块卡覆盖 app/modules/auth，迁移目录历史游离）；语义归属 backend:auth，无需 rebuild（与既有 190+ 迁移同状态）
- `backend/tests/modules/auth/test_my_avatar.py` / `backend/tests/modules/daemon/test_group_member_avatar_fallback.py` —— tests 目录游离（同上惯例）；语义归属对应模块
- `frontend/src/app/(dashboard)/account/page.test.tsx`、`NEW:frontend/src/app/m/account/page.test.tsx`、`NEW:frontend/src/components/__tests__/top-bar-avatar.test.tsx` —— 测试文件游离惯例；语义归属 frontend:app/components

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 无需 rebuild：未匹配文件均为 migrations/tests 历史游离惯例，语义归属已在上表判明 | skipped（有据） |
