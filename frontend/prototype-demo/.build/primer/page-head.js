"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PageHead = PageHead;
const jsx_runtime_1 = require("react/jsx-runtime");
function PageHead({ breadcrumb, title, titleExtra, subtitle, actions, className, }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: `flex flex-col gap-2 ${className ?? ""}`, children: [breadcrumb ? ((0, jsx_runtime_1.jsx)("nav", { className: "text-xs text-muted-foreground", "aria-label": "\u9762\u5305\u5C51", children: breadcrumb })) : null, (0, jsx_runtime_1.jsxs)("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex min-w-0 flex-wrap items-center gap-2.5", children: [(0, jsx_runtime_1.jsx)("h1", { className: "truncate text-xl font-semibold leading-7", children: title }), titleExtra] }), actions ? ((0, jsx_runtime_1.jsx)("div", { className: "flex flex-shrink-0 items-center gap-2", children: actions })) : null] }), subtitle ? ((0, jsx_runtime_1.jsx)("div", { className: "text-xs leading-5 text-muted-foreground", children: subtitle })) : null] }));
}
