# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `backend/app/modules/auth/model.py` <!--TODO: 归属判定-->
- `NEW:backend/migrations/versions/2026xxxx_users_avatar.py` <!--TODO: 归属判定-->
- `backend/app/modules/auth/schema.py` <!--TODO: 归属判定-->
- `backend/app/modules/auth/router.py` <!--TODO: 归属判定-->
- `backend/app/modules/auth/service.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/group/service/helpers.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/group/service/members.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/group/service/crud.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/group/service/__init__.py` <!--TODO: 归属判定-->
- `frontend/src/stores/session.ts` <!--TODO: 归属判定-->
- `frontend/src/lib/auth.ts` <!--TODO: 归属判定-->
- `frontend/src/components/group-chat/group-member-avatar.tsx` <!--TODO: 归属判定-->
- `frontend/src/app/(dashboard)/account/page.tsx` <!--TODO: 归属判定-->
- `frontend/src/app/m/account/page.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/app-shell.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/top-bar.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/daemon/turn-timeline.tsx` <!--TODO: 归属判定-->
- `frontend/src/lib/api-types.ts` <!--TODO: 归属判定-->
- `backend/openapi.json` <!--TODO: 归属判定-->
- `NEW:backend/tests/modules/auth/test_my_avatar.py` <!--TODO: 归属判定-->
- `NEW:backend/tests/modules/daemon/test_group_member_avatar_fallback.py` <!--TODO: 归属判定-->
- `frontend/src/app/(dashboard)/account/page.test.tsx` <!--TODO: 归属判定-->
- `NEW:frontend/src/app/m/account/page.test.tsx` <!--TODO: 归属判定-->
- `NEW:frontend/src/components/__tests__/top-bar-avatar.test.tsx` <!--TODO: 归属判定-->

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | <!--TODO: 有未匹配文件，判定模块索引是否需增改（modules rebuild）--> | pending |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
