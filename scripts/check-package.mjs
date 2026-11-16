import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceDirectory = join(root, "src");

const problems = [];

function check(condition, message) {
  if (!condition) problems.push(message);
}

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) return sourceFiles(fullPath);
    return fullPath.endsWith(".ts") || fullPath.endsWith(".tsx") ? [fullPath] : [];
  });
}

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

check(manifest.type === "module", "package.json must set type to module");
check(manifest.main === undefined, "package.json must not define main");
check(manifest.module === undefined, "package.json must not define module");
check(manifest.types === undefined, "package.json must not define types");
check(manifest.files?.includes("src"), "package.json files must include src");

const expectedExports = {
  ".": "./src/index.ts",
  "./rpc": "./src/rpc.ts",
  "./tui": "./src/tui.ts",
};

check(
  JSON.stringify(manifest.exports) === JSON.stringify(expectedExports),
  `package.json exports must be ${JSON.stringify(expectedExports)}`,
);

for (const target of Object.values(manifest.exports ?? {})) {
  check(/^\.\/src\/.+\.tsx?$/.test(target), `${target} must point at a TypeScript source file`);
  check(existsSync(join(root, target)), `${target} does not exist`);
}

const importPattern = /(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']/g;

for (const file of sourceFiles(sourceDirectory)) {
  const contents = readFileSync(file, "utf8");
  for (const match of contents.matchAll(importPattern)) {
    const specifier = match[1];
    if (!specifier || (!specifier.startsWith("./") && !specifier.startsWith("../"))) continue;
    check(
      specifier.endsWith(".ts") || specifier.endsWith(".tsx"),
      `${file} must import ${specifier} with a .ts or .tsx extension`,
    );
    check(existsSync(join(dirname(file), specifier)), `${file} imports missing ${specifier}`);
  }
}

const packed = JSON.parse(
  execSync("npm pack --dry-run --ignore-scripts --json", { cwd: root, encoding: "utf8" }),
);
const packedPaths = new Set(packed.flatMap((entry) => entry.files.map((file) => file.path)));

for (const target of Object.values(manifest.exports ?? {})) {
  const packedPath = target.replace(/^\.\//, "");
  check(packedPaths.has(packedPath), `${target} is not included in the packed tarball`);
}

if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`- ${problem}\n`);
  process.exit(1);
}

process.stdout.write("Package contents and import graph are valid.\n");
