export default {
  "*": ["npx secretlint"],
  "package.json": ["npx sort-package-json"],
  // Regenerate AI tool configurations when rulesync source files change.
  ".rulesync/**/*": [() => "pnpm generate"],
};
