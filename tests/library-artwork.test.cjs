const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const view = fs.readFileSync(path.join(root, 'src/components/LibraryView.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');

assert.match(view, /artworkKind === 'icon' \? 'is-file-icon' : 'is-cover-art'/,
  'Library artwork distinguishes full cover art from native Windows file icons');
assert.match(view, /setCoverFailed\(false\); setIconFailed\(false\)/,
  'Changing a cover or icon clears the previous image-error state');
assert.match(view, /game\.iconDataUrl \|\| ''/, 'Native Windows icon remains the fallback when uploaded artwork is absent or fails');
assert.match(view, /artworkKind === 'cover' \? setCoverFailed\(true\) : setIconFailed\(true\)/,
  'A failed image falls back from custom cover to the native icon, then to the game placeholder');
assert.match(view, /<span>Remove from Library<\/span>/,
  'The manual-game three-dot menu contains a Remove from Library action');
assert.match(view, /This does not uninstall or delete the game/,
  'The confirmation dialog explicitly explains that the game and files are kept');
assert.match(view, /bridge\.removeManualGame\(game\.id\)/,
  'The UI calls the dedicated Library-only remove action');

const stageRules = [...css.matchAll(/\.mn-installed-art\s*\{([^}]+)\}/g)];
assert.ok(stageRules.length, 'Library artwork frame styles exist');
assert.match(stageRules.at(-1)[1], /height:\s*174px/);
assert.match(stageRules.at(-1)[1], /padding:\s*10px/);
assert.match(stageRules.at(-1)[1], /place-items:\s*center/);

const gridRules = [...css.matchAll(/\.mn-installed-grid\s*\{([^}]+)\}/g)];
assert.ok(gridRules.some(rule => /grid-template-columns:\s*repeat\(5,\s*minmax\(0,1fr\)\)/.test(rule[1])),
  'Library uses five FitGirl-sized cards per desktop row');
assert.match(css, /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.mn-installed-grid\s*\{\s*grid-template-columns:\s*repeat\(4,/);
assert.match(css, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.mn-installed-grid\s*\{\s*grid-template-columns:\s*repeat\(3,/);
assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.mn-installed-grid\s*\{\s*grid-template-columns:\s*repeat\(2,/);
assert.match(css, /@media\s*\(max-width:\s*520px\)[\s\S]*?\.mn-installed-grid\s*\{\s*grid-template-columns:\s*minmax\(0,1fr\)/);

const imageRules = [...css.matchAll(/\.mn-installed-art\s*>\s*img\.mn-installed-art-image\s*\{([^}]+)\}/g)];
assert.ok(imageRules.length, 'Library cover image style exists');
assert.ok(imageRules.some(rule => /object-fit:\s*contain\s*!important/.test(rule[1])),
  'Square and portrait images must be fully visible without cropping');
assert.ok(imageRules.some(rule => /object-position:\s*center center/.test(rule[1])));

const iconRules = [...css.matchAll(/\.mn-installed-art\s*>\s*img\.mn-installed-art-image\.is-file-icon\s*\{([^}]+)\}/g)];
assert.ok(iconRules.length, 'Native Windows icon style exists');
assert.ok(iconRules.some(rule => /width:\s*112px/.test(rule[1])));
assert.ok(iconRules.some(rule => /height:\s*112px/.test(rule[1])));
assert.ok(iconRules.some(rule => /object-fit:\s*contain/.test(rule[1])));

console.log('Library artwork tests passed: FitGirl-sized 174px art stage, centered contain for square covers, visible Windows icons, and responsive image-error fallback.');