/**
 * @type {import('lint-staged').Configuration}
 */
module.exports = {
  "{e2e-tests/**,.ci/pipelines/**,.lintstagedrc.cjs}": () =>
    "yarn --cwd e2e-tests test:unit",
};
