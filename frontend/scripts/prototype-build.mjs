/**
 * prototype compiler —— 真码原型 → 自包含静态 HTML（2026-09-27-prototype-pipeline）。
 *
 * 管线：tsc 编译全部视图子图 → react-dom/server 逐视图静态渲染 →
 *       tailwind 按项目配置编译一次（CSS 各视图共用）→
 *       每视图产出一个单文件 HTML（CSS 内联 + vanilla JS 主题切换/tab 过滤）+ index 索引页。
 *
 * 运行：cd frontend && pnpm prototype:build
 * 产物：frontend/prototype-dist/*.html（双击打开，零依赖零服务；入仓对账——
 *       提交后重编译 git diff 必须为空，禁止手改产物）。
 * 规约：.sillyspec/docs/SillyHub/scan/PROTOTYPE.md（页面类/流程类/规则类分型）。
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = "prototype-dist/.build";
const SRC_DIR = "src/components/prototype";

const VIEWS = [
  { file: "change-center-view", title: "变更中心列表", desc: "面包屑/页头/工具条/UnderlineNav/IssueRow 列表/x-y 脚注" },
  { file: "change-detail-view", title: "变更详情", desc: "阶段 checks 横条/时间线主线/MetaPanel 六组右栏" },
  { file: "workspace-list-view", title: "工作区列表", desc: "Repositories 行式列表/守护徽标/Counter/规范分页" },
  { file: "workspace-overview-view", title: "工作区概览", desc: "Repo 式页头/守护横幅/统计四格/两栏+About" },
  { file: "session-portal-view", title: "会话门户", desc: "三栏：会话列表/消息流/信息面板" },
  { file: "sillyspec-flow-view", title: "SillySpec 变更流程", desc: "流程类原型：轻量道/完整道双泳道状态机（FlowDiagram）" },
];

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error(`[prototype-build] ${cmd} ${args.join(" ")} 失败（exit ${r.status}）`);
    process.exit(1);
  }
}

/* 1. tsc：全部视图依赖子图 → CJS（primer 组件仅相对导入 + react，可独立编译） */
run("npx", [
  "tsc",
  ...VIEWS.map((v) => `${SRC_DIR}/${v.file}.tsx`),
  "--jsx", "react-jsx",
  "--module", "commonjs",
  "--moduleResolution", "node",
  "--target", "es2020",
  "--esModuleInterop",
  "--skipLibCheck",
  "--outDir", OUT_DIR,
]);

/* 2. 逐视图静态渲染（rootDir 推断为 src/components，产物在 .build/prototype/ 下） */
const require = createRequire(import.meta.url);
const React = require("react");
const renderToStaticMarkup = require("react-dom/server").renderToStaticMarkup;
const rendered = VIEWS.map((v) => {
  const mod = require(join(process.cwd(), OUT_DIR, "prototype", `${v.file}.js`));
  const Comp = Object.values(mod)[0]; // 每视图文件唯一具名导出
  return { ...v, html: renderToStaticMarkup(React.createElement(Comp)) };
});

/* 3. Tailwind：项目原配置编译一次（content 覆盖 src/components/**，含全部视图） */
run("npx", ["tailwindcss", "-i", "src/app/globals.css", "-o", `${OUT_DIR}/app.css`, "--minify"]);
const css = readFileSync(join(process.cwd(), OUT_DIR, "app.css"), "utf8");

/* 4. 组装产物（每视图一份 + index） */
const script = `
var KEYS = ["all","active","pending","archived"];
var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
var rows = Array.prototype.slice.call(document.querySelectorAll('[data-cat]'));
function setTab(k) {
  tabs.forEach(function (b, i) {
    var on = KEYS[i] === k;
    b.style.borderBottom = on ? "2px solid var(--color-brand-600)" : "2px solid transparent";
    b.style.color = on ? "var(--color-brand-600)" : "";
    b.style.fontWeight = on ? "600" : "";
  });
  var n = 0;
  rows.forEach(function (r) {
    var show = k === "all" || r.dataset.cat.split(" ").indexOf(k) >= 0;
    r.style.display = show ? "" : "none";
    if (show) n++;
  });
  var foot = document.getElementById("showing");
  if (foot && rows.length) foot.textContent = "显示 " + n + " / " + rows.length + " 个变更";
}
if (tabs.length && rows.length) {
  tabs.forEach(function (b, i) { b.addEventListener("click", function () { setTab(KEYS[i]); }); });
}
Array.prototype.forEach.call(document.querySelectorAll("[data-theme-btn]"), function (b) {
  b.addEventListener("click", function () {
    var t = b.dataset.themeBtn;
    if (t === "ai-native") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  });
});
`;

function page(title, body) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · prototype-as-code</title>
<style>
${css}
body { font-family: Inter, "Segoe UI", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
</style>
</head>
<body>
${body}
<script>
${script}
</script>
</body>
</html>
`;
}

for (const v of rendered) {
  writeFileSync(
    join(process.cwd(), "prototype-dist", `${v.file.replace(/-view$/, "")}.html`),
    page(v.title, v.html)
  );
}

/* index：视图索引（独立文件间跳转用相对链接，离线可用） */
const indexBody = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>prototype-as-code · 索引</title>
<style>
${css}
body { font-family: Inter, "Segoe UI", system-ui, "PingFang SC", "Microsoft YaHei", sans-serif; }
</style></head>
<body class="bg-background text-foreground">
<div class="mx-auto max-w-2xl px-6 py-10">
  <h1 class="text-xl font-semibold">prototype-as-code · 视图索引</h1>
  <p class="mt-1 text-xs text-muted-foreground">全部由真实 primer 组件 + Tailwind + themes.ts token 编译生成 · 数据为 fixture · 各页内可切三主题</p>
  <ul class="mt-6 flex flex-col gap-2">
    ${rendered
      .map(
        (v) => `<li class="rounded-lg border px-4 py-3 transition-colors hover:bg-muted/60" style="border-color:hsl(var(--border))">
      <a class="text-sm font-semibold text-primary hover:underline" href="${v.file.replace(/-view$/, "")}.html">${v.title}</a>
      <div class="mt-0.5 text-xs text-muted-foreground">${v.desc}</div>
    </li>`
      )
      .join("\n    ")}
  </ul>
</div>
</body></html>`;
writeFileSync(join(process.cwd(), "prototype-dist", "index.html"), indexBody);

console.log(
  `[prototype-build] 产物：${rendered.map((v) => `${v.file.replace(/-view$/, "")}.html`).join(" ")} + index.html`
);
