import { dynamicPluginsInfoPlugin } from './plugin';

describe('dynamic-plugins-info', () => {
  it('should export plugin', () => {
    expect(dynamicPluginsInfoPlugin).toBeDefined();
  });
});
