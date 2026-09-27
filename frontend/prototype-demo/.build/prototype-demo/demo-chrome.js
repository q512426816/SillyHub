"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DemoBar = DemoBar;
const jsx_runtime_1 = require("react/jsx-runtime");
function DemoBar() {
    const themeBtn = "rounded-md border px-2 py-0.5 text-xs transition-colors hover:bg-muted";
    return ((0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs text-muted-foreground", style: {
            backgroundColor: "hsl(var(--muted))",
            borderColor: "hsl(var(--border))",
        }, children: [(0, jsx_runtime_1.jsx)("span", { children: "prototype-as-code \u6F14\u793A \u00B7 \u672C\u6587\u4EF6\u7531\u771F\u5B9E primer \u7EC4\u4EF6 + Tailwind + themes.ts token \u7F16\u8BD1\u751F\u6210\uFF0C\u6570\u636E\u4E3A fixture" }), (0, jsx_runtime_1.jsx)("span", { className: "flex items-center gap-1.5", children: ["ai-native", "blue", "dark"].map((t) => ((0, jsx_runtime_1.jsx)("button", { type: "button", "data-theme-btn": t, className: themeBtn, style: { borderColor: "hsl(var(--border))" }, children: t }, t))) })] }));
}
