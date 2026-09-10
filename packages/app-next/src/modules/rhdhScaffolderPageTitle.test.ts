import {
  RHDH_SELF_SERVICE_PAGE_TITLE,
  rhdhScaffolderPlugin,
} from './rhdhScaffolderPageTitle';

describe('rhdhScaffolderPlugin', () => {
  it('keeps the upstream scaffolder plugin id', () => {
    expect(rhdhScaffolderPlugin.id).toBe('scaffolder');
  });

  it('overrides the Create page extension', () => {
    expect(rhdhScaffolderPlugin.getExtension('page:scaffolder')).toBeDefined();
  });

  it('uses Self-service as the RHDH page title', () => {
    expect(RHDH_SELF_SERVICE_PAGE_TITLE).toBe('Self-service');
  });
});
