---
id: task-02
title: "Remove src/build-id.ts from git tracking (.gitignore + git rm --cached)"
title_zh: "build-id.ts 移出版控（.gitignore + git rm --cached）"
author: WhaleFall
created_at: 2026-08-04 11:14:15
priority: P0
depends_on: [task-01]
blocks: [task-03, task-06, task-10]
requirement_ids: [FR-03]
decision_ids: [D-003@v1]
allowed_paths:
  - sillyhub-daemon/.gitignore
  - sillyhub-daemon/src/build-id.ts
expects_from:
  task: task-01
  contract: BUILD_ID 生成
  what: scripts/gen-build-id.mjs 在 prebuild/postinstall 时写 src/build-id.ts（内容 export const BUILD_ID: string = "<sha>-<ts>"）
  why: build-id.ts 移出版控后由 gen 负责（重新）生成，本 task 不改其内容
goal: >
  将 src/build-id.ts 从 git 版控中移出，作为构建产物保留在本地：先在 .gitignore
  生效 src/build-id.ts 规则，再 git rm --cached 移除跟踪。配合 task-01 的
  gen-build-id.mjs 在 prebuild/postinstall 重新生成，保证 git 工作区不再因
  每次 build 脏污，clone/CI 首次 install 后 tsc 也不缺文件（FR-03, D-003）。
implementation:
  - 确认 sillyhub-daemon/.gitignore 含 src/build-id.ts 一行（已存在则跳过新增，仅校验规则命中）
  - 顺序铁律：先确保 .gitignore 规则生效，再执行 git rm --cached src/build-id.ts（避免 postinstall 在 ignore 前写文件引发 CI diff，详见 design §12 ⑤）
  - 在 sillyhub-daemon 目录执行 git rm --cached src/build-id.ts（仅删跟踪，保留工作区文件作为构建产物），生成提交由 sillyspec execute 统一处理
  - 校验 git check-ignore -v src/build-id.ts 命中 .gitignore 规则；git ls-files src/build-id.ts 应为空
  - 不改 src/build-id.ts 内容（写动作归 task-01 的 gen-build-id.mjs）；若文件当前是旧硬编码值，留给 task-03 接 prebuild 后由 gen 重写
acceptance:
  - .gitignore 中存在 src/build-id.ts 忽略规则且 git check-ignore 验证命中
  - git ls-files --error-unmatch src/build-id.ts 失败（已脱离版控），git ls-files src/build-id.ts 无输出
  - 工作区 src/build-id.ts 文件仍存在（git rm --cached 不删磁盘文件），daemon tsc 编译不缺文件
  - git status 仅记录 build-id.ts 的 deleted（来自 --cached），不出现内容修改冲突
verify:
  - 跑 git check-ignore -v src/build-id.ts，输出指向 sillyhub-daemon/.gitignore:6（或对应行号）
  - 跑 git ls-files src/build-id.ts，确认空输出
  - 跑 ls src/build-id.ts（或 Get-Content），确认磁盘文件仍存在
  - 后续 task-03 接 prebuild/postinstall 后，task-10 验证 clone + pnpm install + pnpm build 不缺 build-id.ts（D-003 AC）
constraints:
  - 顺序铁律：.gitignore 规则必须先于 git rm --cached 生效，反序会让 postinstall 在 ignore 前重新写文件产生 CI diff
  - 不改 src/build-id.ts 内容（gen 负责），本 task 只调版控状态
  - 不改 package.json scripts（prebuild/postinstall 接线归 task-03）
  - 不改 build-bundle.sh（替换 printf 归 task-04）
  - 仅调 sillyhub-daemon 子目录的 git 索引，不影响仓库其它路径
  - git rm --cached 不带 -r，单文件操作；不删除磁盘文件
---
