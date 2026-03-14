const backstageConfig = require('@backstage/cli/config/eslint-factory')(
  __dirname,
);

module.exports = {
  ...backstageConfig,
  rules: {
    ...backstageConfig.rules,
    'react/react-in-jsx-scope': 'off',
    'react/jsx-uses-react': 'off',
  },
};
