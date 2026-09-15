import { renderWithEffects } from '@backstage/test-utils';

jest.mock('./modules/dynamicFeatures/rhdhDynamicFrontendFeaturesLoader', () => {
  const { createFrontendFeatureLoader } = jest.requireActual(
    '@backstage/frontend-plugin-api',
  );
  return {
    rhdhDynamicFrontendFeaturesLoader: () =>
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
            },
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
