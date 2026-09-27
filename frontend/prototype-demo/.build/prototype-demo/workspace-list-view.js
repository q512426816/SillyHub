"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceListView = WorkspaceListView;
const jsx_runtime_1 = require("react/jsx-runtime");
const primer_1 = require("../primer");
const demo_chrome_1 = require("./demo-chrome");
const WORKSPACES = [
    {
        state: "open",
        name: "multi-agent-platform",
        visibility: "私有",
        path: "C:/Users/qinyi/IdeaProjects/multi-agent-platform",
        stack: ["Next.js", "Node", "Python"],
        guard: "运行中",
        activeChanges: 3,
        scanned: "3 分钟前",
    },
    {
        state: "open",
        name: "sillyspec",
        visibility: "私有",
        path: "C:/Users/qinyi/IdeaProjects/sillyspec",
        stack: ["Node", "CLI"],
        guard: "运行中",
        activeChanges: 2,
        scanned: "8 分钟前",
    },
    {
        state: "open",
        name: "happy",
        visibility: "组织",
        path: "C:/Users/qinyi/IdeaProjects/happy",
        stack: ["React", "Rust"],
        guard: "运行中",
        activeChanges: 0,
        scanned: "26 分钟前",
    },
    {
        state: "neutral",
        name: "prompts-r14",
        visibility: "私有",
        path: "C:/Users/qinyi/IdeaProjects/prompts-r14",
        stack: ["Markdown"],
        guard: "已停用",
        activeChanges: 0,
        scanned: "5 天前",
    },
    {
        state: "neutral",
        name: "cc-switch",
        visibility: "私有",
        path: "C:/Users/qinyi/IdeaProjects/cc-switch",
        stack: ["Go"],
        guard: "已停用",
        activeChanges: 0,
        scanned: "2 周前",
    },
];
function TechPill({ tech }) {
    return ((0, jsx_runtime_1.jsx)("span", { className: "rounded-full border px-1.5 font-mono text-xs leading-4 text-muted-foreground", style: { borderColor: "hsl(var(--border))" }, children: tech }));
}
function WorkspaceListView() {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "min-h-screen bg-background text-foreground", children: [(0, jsx_runtime_1.jsx)(demo_chrome_1.DemoBar, {}), (0, jsx_runtime_1.jsxs)("main", { className: "mx-auto max-w-4xl px-6 py-8", children: [(0, jsx_runtime_1.jsx)(primer_1.PageHead, { breadcrumb: (0, jsx_runtime_1.jsxs)("span", { className: "flex items-center gap-1.5", children: [(0, jsx_runtime_1.jsx)("span", { children: "SillyHub" }), (0, jsx_runtime_1.jsx)("span", { className: "text-muted-foreground/60", children: "/" }), (0, jsx_runtime_1.jsx)("span", { className: "text-foreground", children: "\u5DE5\u4F5C\u533A" })] }), title: "\u5DE5\u4F5C\u533A", titleExtra: (0, jsx_runtime_1.jsx)(primer_1.Counter, { count: WORKSPACES.length }), subtitle: "\u6587\u6863\u9A71\u52A8\u5F00\u53D1\u7684\u5DE5\u4F5C\u533A \u00B7 \u62D6\u62FD\u884C\u53EF\u6392\u5E8F \u00B7 \u5220\u9664\u9700\u4E8C\u6B21\u786E\u8BA4", actions: (0, jsx_runtime_1.jsx)("button", { type: "button", className: "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90", children: "\u65B0\u5EFA\u5DE5\u4F5C\u533A" }) }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-6 flex flex-wrap items-center justify-between gap-3", children: [(0, jsx_runtime_1.jsx)("input", { placeholder: "\u641C\u7D22\u5DE5\u4F5C\u533A\u540D / \u8DEF\u5F84\u2026", className: "h-8 w-64 rounded-md border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground", style: { borderColor: "hsl(var(--input))" } }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "h-8 rounded-md border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted", style: { borderColor: "hsl(var(--border))" }, children: "\u540C\u6B65\u5168\u90E8" })] }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-4 overflow-hidden rounded-lg border bg-card", style: { borderColor: "hsl(var(--border))" }, children: [(0, jsx_runtime_1.jsx)(primer_1.IssueRowHeader, { title: (0, jsx_runtime_1.jsx)("span", { className: "font-medium", children: "\u540D\u79F0" }), right: (0, jsx_runtime_1.jsx)("span", { className: "text-xs font-normal text-muted-foreground", children: "\u6280\u672F\u6808 \u00B7 \u5B88\u62A4 \u00B7 \u6D3B\u8DC3\u53D8\u66F4 \u00B7 \u626B\u63CF" }) }), (0, jsx_runtime_1.jsx)("div", { className: "divide-y", style: { borderColor: "hsl(var(--border))" }, children: WORKSPACES.map((w) => ((0, jsx_runtime_1.jsx)("div", { "data-cat": "ws", children: (0, jsx_runtime_1.jsx)(primer_1.IssueRow, { state: w.state, title: (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("a", { href: "#", className: "text-sm font-semibold leading-5 text-primary hover:underline", children: w.name }), (0, jsx_runtime_1.jsx)(primer_1.StateLabel, { variant: "neutral", withIcon: false, children: w.visibility })] }), meta: (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("span", { className: "truncate font-mono text-xs text-muted-foreground", children: w.path }), w.stack.map((t) => ((0, jsx_runtime_1.jsx)(TechPill, { tech: t }, t)))] }), right: (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)(primer_1.StateLabel, { variant: w.guard === "运行中" ? "done" : "neutral", withIcon: false, children: w.guard }), (0, jsx_runtime_1.jsx)(primer_1.Counter, { count: w.activeChanges }), (0, jsx_runtime_1.jsx)("span", { className: "text-xs text-muted-foreground", children: w.scanned })] }) }) }, w.name))) }), (0, jsx_runtime_1.jsxs)("div", { className: "flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground", style: { borderColor: "hsl(var(--border))" }, children: [(0, jsx_runtime_1.jsxs)("span", { children: ["\u663E\u793A ", WORKSPACES.length, " / ", WORKSPACES.length, " \u4E2A\u5DE5\u4F5C\u533A"] }), (0, jsx_runtime_1.jsxs)("span", { className: "flex items-center gap-2", children: [(0, jsx_runtime_1.jsx)("button", { type: "button", className: "rounded-md border px-2 py-0.5 transition-colors hover:bg-muted disabled:opacity-40", style: { borderColor: "hsl(var(--border))" }, disabled: true, children: "\u4E0A\u4E00\u9875" }), (0, jsx_runtime_1.jsx)("span", { className: "font-mono", children: "1 / 1" }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "rounded-md border px-2 py-0.5 transition-colors hover:bg-muted disabled:opacity-40", style: { borderColor: "hsl(var(--border))" }, disabled: true, children: "\u4E0B\u4E00\u9875" })] })] })] })] })] }));
}
