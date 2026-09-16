/**
 * @type {import('lint-staged').Configuration}
 */
module.exports = {
  "{rulesync.jsonc,.rulesyncignore,opencode.jsonc,.{cursor,claude,opencode,rulesync}/**/*.{mdc,md,json,jsonc}}":
    (filenames) => {
      const hasRulesync = filenames.some(
        (f) => f === "rulesync.jsonc" || f === ".rulesyncignore" || f.includes(".rulesync/")
      );
      const changedDirs = ["cursor", "claude", "opencode"].filter((dir) =>
        filenames.some((f) => f.includes(`.${dir}/`))
      );
      const changedConfig = filenames.includes("opencode.jsonc");

      // If a Rulesync source or config changed, generate and sync all outputs.
      if (hasRulesync) {
        return ["yarn rulesync:generate", "git add .cursor .claude .opencode opencode.jsonc"];
      }

      // If generated files changed directly, throw an error.
      if (changedDirs.length > 0 || changedConfig) {
        changedDirs.forEach((dir) => {
          console.error(`⚠️  Direct changes to .${dir} detected!`);
          console.error("Files triggering check:", filenames.filter((f) => f.includes(`.${dir}/`)));
          console.error("💡 To sync back to .rulesync, run:");
          console.error(`   yarn rulesync:import:${dir}\n`);
        });
        if (changedConfig) {
          console.error("⚠️  Direct changes to opencode.jsonc detected!");
          console.error("💡 To sync back to .rulesync, run:");
          console.error("   yarn rulesync:import:opencode\n");
        }

        throw new Error(
          `❌ Direct changes to ${[
            ...changedDirs.map((d) => `.${d}`),
            ...(changedConfig ? ["opencode.jsonc"] : []),
          ].join(" and ")} are not allowed.`
        );
      }

      return [];
    },
};
