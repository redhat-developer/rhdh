import { renderWithEffects } from '@backstage/test-utils';

jest.mock('@backstage/frontend-dynamic-feature-loader', () => {
  const { createFrontendFeatureLoader } = jest.requireActual(
    '@backstage/frontend-plugin-api',
  );
  return {
    dynamicFrontendFeaturesLoader: () =>
      createFrontendFeatureLoader({
        async loader() {
          return [];
        },
      }),
  };
});

describe('App', () => {
  it('should render', async () => {
    process.env = {
      NODE_ENV: 'test',
      APP_CONFIG: [
        {
          data: {
            app: {
              title: 'Test',
              support: { url: 'http://localhost:7007/support' },
              extensions: [
                { 'page:home': { config: { path: '/' } } },
                { 'api:home/visits': true },
                { 'app-root-element:home/visit-listener': true },
                { 'app-root-wrapper:app/global-header': true },
                { 'app-root-wrapper:app/drawer': true },
                { 'app-drawer-content:quickstart/quickstart': true },
                { 'gh-menu-item:quickstart/quickstart': false },
                { 'gh-menu-item:app/quickstart-help': true },
              ],
            },
            auth: { environment: 'development' },
            backend: { baseUrl: 'http://localhost:7007' },
            dynamicPlugins: { rootDirectory: 'dynamic-plugins-root' },
            lighthouse: {
              baseUrl: 'http://localhost:3003',
            },
            techdocs: {
              storageUrl: 'http://localhost:7007/api/techdocs/static/docs',
            },
          },
          context: 'test',
        },
      ] as any,
    };

    const { default: app } = await import('./App');
    const rendered = await renderWithEffects(app);
    expect(rendered.baseElement).toBeInTheDocument();
  }, 100_000);
});
