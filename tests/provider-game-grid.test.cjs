const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const view = fs.readFileSync(path.join(root, "src/components/SearchScraperView.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/index.css"), "utf8");

assert.match(view, /mn-games-grid[^\n]*\['fitgirl',\s*'gog'\]\.includes\(source\)/,
  "FitGirl and GOG should retain their five-column provider grid");
assert.match(view, /className="mn-game-card mn-game-card-enter group flex flex-col text-left cursor-pointer w-full"/,
  "FitGirl and GOG must use the same card class as EroLabs");
assert.doesNotMatch(view, /mn-game-card-compact|mn-game-cover-backdrop/,
  "No special inset/shadow frame or blurred duplicate artwork should remain");
assert.match(view, /\['fitgirl',\s*'gog'\]\.includes\(game\.sourceId\s*\|\|\s*source\)[\s\S]*?image\.naturalWidth\s*\/\s*image\.naturalHeight/,
  "FitGirl/GOG cover frame must use the real artwork aspect ratio");

const providerGrid = css.match(/\.mn-games-grid\.mn-games-grid-provider\s*\{([^}]+)\}/);
assert.ok(providerGrid, "Provider-specific grid rule must exist");
assert.match(providerGrid[1], /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
assert.match(css, /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.mn-games-grid\.mn-games-grid-provider\s*\{\s*grid-template-columns:\s*repeat\(4,/);
assert.match(css, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.mn-games-grid\.mn-games-grid-provider\s*\{\s*grid-template-columns:\s*repeat\(3,/);
assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.mn-games-grid\.mn-games-grid-provider\s*\{\s*grid-template-columns:\s*repeat\(2,/);
assert.match(css, /@media\s*\(max-width:\s*520px\)[\s\S]*?\.mn-games-grid\.mn-games-grid-provider\s*\{\s*grid-template-columns:\s*repeat\(1,/);

const coverRules = [...css.matchAll(/\.mn-game-cover-image\s*\{([^}]+)\}/g)];
assert.ok(coverRules.length, "Shared EroLabs-style artwork rule must exist");
assert.ok(coverRules.some(match => /width:\s*100%/.test(match[1]) && /height:\s*100%/.test(match[1])));
assert.ok(coverRules.some(match => /object-fit:\s*cover/.test(match[1])),
  "Artwork must fill the cover canvas like EroLabs");
assert.doesNotMatch(css, /mn-game-card-compact|mn-game-cover-backdrop/,
  "Old inset and blurred-backdrop styles should be removed");

// The EroLabs branch retains the existing clamped artwork-ratio behaviour.
assert.match(view, /\['fitgirl',\s*'gog'\]\.includes\(game\.sourceId\s*\|\|\s*source\)[\s\S]*?Math\.min\(1\.85,\s*Math\.max\(0\.58,/);

console.log("Provider artwork tests passed: FitGirl/GOG share EroLabs' edge-to-edge cover style, use natural image proportions, retain five desktop columns, and leave EroLabs logic unchanged.");