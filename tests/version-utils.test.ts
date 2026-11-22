import assert from "node:assert/strict";
import { compareNumericVersions, isNewerVersion } from "../version-utils";

assert.equal(compareNumericVersions("1.2.11", "1.2.5"), 1);
assert.equal(compareNumericVersions("v1.3.0", "1.2.11"), 1);
assert.equal(compareNumericVersions("1.2.11", "v1.2.11"), 0);
assert.equal(compareNumericVersions("1.2.4", "1.2.11"), -1);
assert.equal(compareNumericVersions("invalid", "1.2.11"), null);
assert.equal(isNewerVersion("1.2.5", "1.2.11"), false);
assert.equal(isNewerVersion("1.2.12", "1.2.11"), true);
console.log("Version comparison tests passed: older releases do not trigger updates.");