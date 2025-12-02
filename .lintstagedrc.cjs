/**
 * @type {import('lint-staged').Configuration}
 */
module.exports = {
  ".{cursor,claude,rulesync}/**/*.{mdc,md,json}": (filenames) => {
    const hasRulesync = filenames.some((f) => f.includes(".rulesync/"));
    const changedDirs = ["cursor", "claude"].filter((dir) =>
      filenames.some((f) => f.includes(`.${dir}/`))
    );

    // If .rulesync changed, generate and sync to .cursor and .claude
    if (hasRulesync) {
      return ["yarn rulesync:generate", "git add .cursor .claude"];
    }

    // If .cursor or .claude changed directly, throw error
    if (changedDirs.length > 0) {
      changedDirs.forEach((dir) => {
        console.error(`⚠️  Direct changes to .${dir} detected!`);
        console.error("Files triggering check:", filenames.filter((f) => f.includes(`.${dir}/`)));
        console.error("💡 To sync back to .rulesync, run:");
        console.error(`   yarn rulesync:import:${dir}\n`);
      });

      throw new Error(
        `❌ Direct changes to ${changedDirs.map((d) => `.${d}`).join(" and ")} are not allowed.`
      );
    }

    return [];
  },
};
