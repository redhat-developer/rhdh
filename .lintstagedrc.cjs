/**
 * @type {import('lint-staged').Configuration}
 */
module.exports = {
  ".{cursor,claude,opencode,rulesync}/**/*.{mdc,md,json}": (filenames) => {
    const hasRulesync = filenames.some((f) => f.includes(".rulesync/"));
    const changedDirs = ["cursor", "claude", "opencode"].filter((dir) =>
      filenames.some((f) => f.includes(`.${dir}/`))
    );

    // If .rulesync changed, generate and sync to .cursor, .claude, and .opencode
    if (hasRulesync) {
      return ["yarn rulesync:generate", "git add .cursor .claude .opencode"];
    }

    // If .cursor, .claude, or .opencode changed directly, throw error
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
