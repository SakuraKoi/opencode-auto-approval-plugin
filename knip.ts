import { type KnipConfig } from "knip";

const config: KnipConfig = {
  // Every published entrypoint and test file is analyzed so unused exports surface in CI.
  entry: ["src/**/*.test.ts", "scripts/**/*.mjs"],
  project: ["src/**/*.ts", "src/**/*.tsx"],
  ignoreDependencies: [
    // Referenced from .secretlintrc.json rather than imported from source.
    "@secretlint/secretlint-rule-preset-recommend",
  ],
};

export default config;
