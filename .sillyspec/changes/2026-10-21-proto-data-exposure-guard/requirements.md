---
author: flow-machine-draft
created_at: 2026-10-20T23:36:08.889Z
---
# 需求规格（Requirements）— 2026-10-21-proto-data-exposure-guard

## 功能需求

### FR-01: 会话导出数据移出免鉴权静态服务面

- **禁止**在 `frontend/public/`（Next.js 免鉴权静态服务目录，原样进构建产物）存放任何真实会话导出数据；现存 `session-export.json`（3.3MB，含用户对话原文/会话 id/1271 条 logs）**必须**移至 `frontend/.proto-staging/`——该目录不进构建、git 不跟踪。

#### 场景：静态暴露通道关闭

- Given dev server（或任何以该 frontend 为根的部署）运行
- When 直访 `/__proto/session-export.json`
- Then 404（public/ 下已无该文件，且 `frontend/public/__proto/` 整目录被 gitignore 覆盖，重 staging 也进不了 git/构建）

#### 场景：staging 数据仍可被服务端读取

- Given `frontend/.proto-staging/session-export.json` 在位
- When Server Component 调 `loadStagedSessionExport()`
- Then 返回解析后的 `StagedSessionExport`（真实数据仍在 dev 预览可用）

### FR-02: proto 预览读取路径随迁，dev 预览能力不回归

- `staged-session-export.ts` 的读取位置**必须**由 `public/__proto/session-export.json` 随迁为 `.proto-staging/session-export.json`（相对 `process.cwd()`=frontend）；文件缺失/损坏/形状不符时**必须**维持既有容错降级 null（页面占位不崩）；`view.tsx` 对 public URL 的运行时 fetch 兜底**必须**移除（数据已不在可 fetch 面，留着是死码+404 噪音）。

#### 场景：SSR 预览主路径不回归

- Given staging 文件在位、dev server 运行
- When 访问 `/proto/session-redesign`
- Then SSR 渲染含真实会话内容（非「加载真实会话…」占位）

#### 场景：容错路径行为保持

- Given staging 文件缺失或 JSON 损坏
- When 访问 `/proto/session-redesign`
- Then 页面渲染占位符、不抛错不白屏（既有 fail-soft 语义零变化）

### FR-03: .gitignore 机制防线覆盖全部残留产物

- `.gitignore` **必须**覆盖 `/.tmp/`、`backend/pytest-of-*/`、`frontend/.proto-staging/`、`frontend/public/__proto/`、`*.TMP` 五类路径；覆盖后 `git status` **禁止**再列出上述任何路径——把 AGENTS.md 规则 11「禁目录级 add」的纪律防线补上机制防线。

#### 场景：误提交面收敛

- Given 上述路径下存在未跟踪内容（.tmp/ 截图、pytest-of-qinyi/ 临时目录、~RF*.TMP 编辑器恢复文件、staging 数据）
- When `git status --porcelain`
- Then 上述路径零出现（untracked 不可见即不可被目录级 add 夹带）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：文件位置迁移与目录布局，无代码逻辑可断言（AGENTS.md 测试分层——纯配置/文件布局不写测试）；验收=git status 人工核验 + staging 文件 JSON 可解析
FR-02: 不适用：dev-only 预览脚手架（frontend/src/app/proto/**），不在生产测试面；静态核验=frontend tsc --noEmit 零错
FR-03: 不适用：纯 .gitignore 配置（AGENTS.md：纯配置不写测试）；验收=git status --porcelain 路径零出现
