---
root: false
targets: ["*"]
description: "When you write any code, must follow these guidelines."
globs: ["**/*.ts"]
---

# Coding Guidelines

- If the arguments are multiple, you should use an object as the argument.
  - Not only function arguments, but also class constructor arguments.
- If you have to write validation logic, please consider using `zod/mini` to do it actively.
  - `zod/mini` is a subset of `zod` that minimizes the bundle size.
- To import code, you should always use static imports. You should not use dynamic imports.
  - Static imports are easier for bundlers to analyze and optimize, e.g. tree-shaking.
- TypeScript file names should be in kebab-case, even for class implementation files.
- Don't create barrel files. Please always import the implementation file directly.
  - Barrel files are harmful to tree-shaking and import path transparency.
- When writing any filesystem path, you must always use the `join` function from `node:path` so that
  both Windows and Unix-like paths are supported.
- When writing non-filesystem paths (e.g. API paths, gitignore entries, generated file content), use
  `path.posix.join` to ensure forward slashes regardless of platform.
- Node.js built-in modules must be imported with the `node:` protocol.
