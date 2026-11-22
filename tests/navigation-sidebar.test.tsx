import React from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { NavigationSidebar } from "../src/components/NavigationSidebar";

const props = {
  activeTab: "search" as const,
  setActiveTab: () => {},
  versionInfo: { currentVersion: "1.2.29" },
  activeDownloadCount: 3,
};

(globalThis as any).localStorage = {
  getItem: (key: string) => key === "mn_sidebar_collapsed" ? null : null,
  setItem: () => {},
};
const expanded = renderToStaticMarkup(React.createElement(NavigationSidebar, props));
assert.match(expanded, /aria-label="Collapse navigation"/);
assert.match(expanded, /MN ZONEX/);
assert.match(expanded, /GAME WORKSPACE/);
assert.ok(expanded.includes("v1.2.29"));
assert.match(expanded, /WORKSPACE/);
assert.match(expanded, /SYSTEM/);

(globalThis as any).localStorage = {
  getItem: (key: string) => key === "mn_sidebar_collapsed" ? "true" : null,
  setItem: () => {},
};
const collapsed = renderToStaticMarkup(React.createElement(NavigationSidebar, props));
assert.match(collapsed, /aria-label="Expand navigation"/);
assert.match(collapsed, /mn-sidebar-brand is-collapsed/);
assert.doesNotMatch(collapsed, /GAME WORKSPACE/);
assert.ok(!collapsed.includes("v1.2.29"));

console.log("Navigation sidebar tests passed: expanded/collapsed layouts, separate version badge, and accessible collapse controls.");