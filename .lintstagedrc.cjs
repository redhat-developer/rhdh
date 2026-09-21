const path = require("node:path");

const generatedFilePattern = /\.(?:mdc?|jsonc?)$/;

/**
 * @type {import('lint-staged').Configuration}
 */
module.exports = {
  "{.rulesync/**,.cursor/**,.cursorignore,.claude/**,.opencode/**,opencode.jsonc,rulesync.jsonc,.rulesyncignore,.lintstagedrc.cjs,package.json,yarn.lock}":
    (filenames) => {
      const normalizedFilenames = filenames.map((filename) =>
        path.relative(__dirname, filename).split(path.sep).join(path.posix.sep),
      );
      const rulesyncInputs = [
        "rulesync.jsonc",
        ".rulesyncignore",
        ".lintstagedrc.cjs",
        "package.json",
        "yarn.lock",
      ];
      const hasRulesync = normalizedFilenames.some(
        (f) =>
          rulesyncInputs.includes(f) ||
          (f.startsWith(".rulesync/") && generatedFilePattern.test(f)),
      );
      const changedDirs = ["cursor", "claude", "opencode"].filter((dir) =>
        normalizedFilenames.some(
          (f) => f.startsWith(`.${dir}/`) && generatedFilePattern.test(f),
        ),
      );
      const changedRootOutputs = [".cursorignore", "opencode.jsonc"].filter(
        (file) => normalizedFilenames.includes(file),
      );

      // If a Rulesync source or config changed, generate and sync all outputs.
      if (hasRulesync) {
        return [
          "yarn rulesync:generate",
          "git add .cursor .cursorignore .claude .opencode opencode.jsonc",
          "yarn rulesync:check",
        ];
      }

      // If generated files changed directly, throw an error.
      if (changedDirs.length > 0 || changedRootOutputs.length > 0) {
        changedDirs.forEach((dir) => {
          console.error(`⚠️  Direct changes to .${dir} detected!`);
          console.error(
            "Files triggering check:",
            normalizedFilenames.filter(
              (f) => f.startsWith(`.${dir}/`) && generatedFilePattern.test(f),
            ),
          );
          console.error("💡 To sync back to .rulesync, run:");
          console.error(`   yarn rulesync:import:${dir}\n`);
        });
        if (changedRootOutputs.includes(".cursorignore")) {
          console.error("⚠️  Direct changes to .cursorignore detected!");
          console.error("💡 To sync back to .rulesync, run:");
          console.error("   yarn rulesync:import:cursor\n");
        }
        if (changedRootOutputs.includes("opencode.jsonc")) {
          console.error("⚠️  Direct changes to opencode.jsonc detected!");
          console.error("💡 To sync back to .rulesync, run:");
          console.error("   yarn rulesync:import:opencode\n");
        }

        throw new Error(
          `❌ Direct changes to ${[
            ...changedDirs.map((d) => `.${d}`),
            ...changedRootOutputs,
          ].join(" and ")} are not allowed.`,
        );
      }

      return ["yarn rulesync:check"];
    },
};
