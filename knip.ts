import { type KnipConfig } from "knip";

const config: KnipConfig = {
  // `src/index.ts` is auto-detected from package.json `exports`/`main`/`module`.
  // Test files are listed explicitly because no enabled plugin covers them.
  entry: ["src/**/*.test.ts"],
  project: ["src/**/*.ts"],
  ignoreDependencies: [
    // Referenced from .secretlintrc.json rather than imported from source.
    "@secretlint/secretlint-rule-preset-recommend",
  ],
};

export default config;
