import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("README demo version matches package.json", async () => {
  const [packageText, readme] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
  ]);
  const packageVersion = JSON.parse(packageText).version;
  const readmeVersion = readme.match(/\*\*版本:\*\* v([^\s]+) Demo/)?.[1];
  assert.ok(readmeVersion, "README 必须声明完整 Demo 版本。");
  assert.equal(readmeVersion, packageVersion);
});
