"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChangeCenterView = ChangeCenterView;
const jsx_runtime_1 = require("react/jsx-runtime");
const primer_1 = require("../primer");
const demo_chrome_1 = require("./demo-chrome");
const FIXTURES = [
    {
        cat: "active",
        state: "open",
        title: "观测事件通道 v3 · 重构",
        changeKey: "2026-09-25-observation-events-v3-r16sf",
        comps: ["backend", "frontend"],
        stage: "实现计划",
        owner: "qinyi",
        cost: "2.4M tok · 18 次",
        time: "5 分钟前",
    },
    {
        cat: "active",
        state: "open",
        title: "探测并发 RPC",
        changeKey: "2026-09-26-probe-concurrent-rpc",
        comps: ["backend"],
        stage: "代码扫描",
        owner: "qinyi",
        cost: "380K tok · 4 次",
        time: "11 分钟前",
    },
    {
        cat: "active",
        state: "error",
        title: "观测事件通道 v3 · 首轮修复",
        changeKey: "2026-09-25-observation-events-v3",
        comps: ["backend"],
        stage: "阻塞",
        owner: "qinyi",
        cost: "1.1M tok · 9 次",
        time: "2 小时前",
    },
    {
        cat: "pending",
        state: "attention",
        attentionIcon: "clock",
        title: "核心页面视觉对齐 · 二期",
        changeKey: "2026-09-27-visual-align-2",
        comps: ["frontend"],
        stage: "等待输入",
        owner: "qinyi",
        cost: "62K tok · 1 次",
        time: "32 分钟前",
    },
    {
        cat: "pending",
        state: "attention",
        attentionIcon: "zap",
        title: "依赖升级 pnpm@9",
        changeKey: "2026-09-27-pnpm-9",
        comps: ["tooling"],
        stage: "轻量变更",
        owner: "qinyi",
        cost: "8K tok · 1 次",
        time: "1 小时前",
    },
    {
        cat: "archived",
        state: "merged",
        title: "watcher 时间线 P2",
        changeKey: "2026-09-26-watcher-timeline-p2",
        comps: ["frontend"],
        stage: "已归档",
        owner: "qinyi",
        cost: "410K tok · 3 次",
        time: "昨天",
    },
    {
        cat: "archived",
        state: "merged",
        title: "thin 检查节奏治理",
        changeKey: "2026-09-26-thin-check-cadence",
        comps: ["cli"],
        stage: "已归档",
        owner: "qinyi",
        cost: "96K tok · 2 次",
        time: "昨天",
    },
    {
        cat: "archived",
        state: "merged",
        title: "动态测试推断",
        changeKey: "2026-09-26-dynamic-test-inference",
        comps: ["cli", "backend"],
        stage: "已归档",
        owner: "qinyi",
        cost: "1.8M tok · 12 次",
        time: "2 天前",
    },
    {
        cat: "archived",
        state: "merged",
        title: "完整流程治理自动化",
        changeKey: "2026-09-26-full-autopilot-parity",
        comps: ["cli"],
        stage: "已归档",
        owner: "qinyi",
        cost: "2.2M tok · 15 次",
        time: "3 天前",
    },
];
/* ------------------------------------------------------------------ */
/* 视图                                                                */
/* ------------------------------------------------------------------ */
function OwnerAvatar({ owner }) {
    return ((0, jsx_runtime_1.jsx)("span", { title: `负责人 ${owner}`, className: "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold", style: {
            backgroundColor: "var(--color-brand-50)",
            color: "var(--color-brand-600)",
        }, children: owner.slice(0, 1).toUpperCase() }));
}
function CompPill({ comp }) {
    return ((0, jsx_runtime_1.jsx)("span", { className: "rounded-full border px-1.5 font-mono text-xs leading-4 text-muted-foreground", style: { borderColor: "hsl(var(--border))" }, children: comp }));
}
/** 演示条见 demo-chrome.tsx（五视图共用）。 */
function ChangeCenterView() {
    const count = (cat) => FIXTURES.filter((f) => f.cat === cat).length;
    return ((0, jsx_runtime_1.jsxs)("div", { className: "min-h-screen bg-background text-foreground", children: [(0, jsx_runtime_1.jsx)(demo_chrome_1.DemoBar, {}), (0, jsx_runtime_1.jsxs)("main", { className: "mx-auto max-w-4xl px-6 py-8", children: [(0, jsx_runtime_1.jsx)(primer_1.PageHead, { breadcrumb: (0, jsx_runtime_1.jsxs)("span", { className: "flex items-center gap-1.5", children: [(0, jsx_runtime_1.jsx)("span", { children: "SillyHub" }), (0, jsx_runtime_1.jsx)("span", { className: "text-muted-foreground/60", children: "/" }), (0, jsx_runtime_1.jsx)("span", { children: "multi-agent-platform" }), (0, jsx_runtime_1.jsx)("span", { className: "text-muted-foreground/60", children: "/" }), (0, jsx_runtime_1.jsx)("span", { className: "text-foreground", children: "\u53D8\u66F4" })] }), title: "\u53D8\u66F4\u4E2D\u5FC3", titleExtra: (0, jsx_runtime_1.jsx)(primer_1.Counter, { count: FIXTURES.length }), subtitle: `文档驱动开发 · ${count("active")} 个进行中 · ${count("pending")} 个待办 · ${count("archived")} 个已归档`, actions: (0, jsx_runtime_1.jsx)("button", { type: "button", className: "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90", children: "\u65B0\u5EFA\u53D8\u66F4" }) }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-6 flex flex-wrap items-center justify-between gap-3", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-center gap-2", children: [(0, jsx_runtime_1.jsx)("input", { placeholder: "\u641C\u7D22\u53D8\u66F4\u540D / key\u2026", className: "h-8 w-64 rounded-md border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2", style: { borderColor: "hsl(var(--input))" } }), (0, jsx_runtime_1.jsx)("span", { className: "text-xs text-muted-foreground", children: "\u5E73\u53F0\u540C\u6B65\u6B63\u5E38 \u00B7 \u4E0A\u6B21 3 \u5206\u949F\u524D" })] }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "h-8 rounded-md border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted", style: { borderColor: "hsl(var(--border))" }, children: "\u5BFC\u51FA" })] }), (0, jsx_runtime_1.jsx)("div", { className: "mt-4", children: (0, jsx_runtime_1.jsx)(primer_1.UnderlineNav, { value: "all", onChange: () => { }, items: [
                                { key: "all", label: "全部", counter: FIXTURES.length },
                                { key: "active", label: "进行中", counter: count("active") },
                                { key: "pending", label: "待办", counter: count("pending") },
                                { key: "archived", label: "已归档", counter: count("archived") },
                            ] }) }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-3 overflow-hidden rounded-lg border bg-card", style: { borderColor: "hsl(var(--border))" }, children: [(0, jsx_runtime_1.jsx)(primer_1.IssueRowHeader, { title: (0, jsx_runtime_1.jsx)("span", { className: "font-medium", children: "\u6807\u9898" }), right: (0, jsx_runtime_1.jsx)("span", { className: "text-xs font-normal text-muted-foreground", children: "\u9636\u6BB5 \u00B7 \u8D1F\u8D23\u4EBA \u00B7 \u6D88\u8017 \u00B7 \u66F4\u65B0" }) }), (0, jsx_runtime_1.jsx)("div", { className: "divide-y", style: { borderColor: "hsl(var(--border))" }, children: FIXTURES.map((f) => ((0, jsx_runtime_1.jsx)("div", { "data-cat": f.cat, children: (0, jsx_runtime_1.jsx)(primer_1.IssueRow, { state: f.state, title: (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("a", { href: "#", className: "text-sm font-semibold leading-5 text-primary hover:underline", children: f.title }), (0, jsx_runtime_1.jsx)(primer_1.StateLabel, { variant: f.state, iconName: f.attentionIcon, withIcon: false, children: f.stage })] }), meta: (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("span", { className: "font-mono text-xs text-muted-foreground", children: f.changeKey }), f.comps.map((c) => ((0, jsx_runtime_1.jsx)(CompPill, { comp: c }, c)))] }), right: (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)(OwnerAvatar, { owner: f.owner }), (0, jsx_runtime_1.jsx)("span", { className: "font-mono text-xs text-muted-foreground", children: f.cost }), (0, jsx_runtime_1.jsx)("span", { className: "text-xs text-muted-foreground", children: f.time })] }) }) }, f.changeKey))) }), (0, jsx_runtime_1.jsxs)("div", { className: "border-t px-4 py-2 text-right text-xs text-muted-foreground", style: { borderColor: "hsl(var(--border))" }, id: "showing", children: ["\u663E\u793A ", FIXTURES.length, " / ", FIXTURES.length, " \u4E2A\u53D8\u66F4"] })] })] })] }));
}
