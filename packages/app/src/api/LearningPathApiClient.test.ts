import {
  ConfigApi,
  DiscoveryApi,
  IdentityApi,
} from '@backstage/core-plugin-api';

import { LearningPathApiClient } from './LearningPathApiClient';

const learningPaths = [
  {
    label: 'Operators on OpenShift',
    url: 'https://example.com',
    minutes: 20,
    paths: 6,
  },
];

const buildClient = (opts?: { proxyPath?: string; token?: string }) => {
  const discoveryApi = {
    getBaseUrl: jest.fn().mockResolvedValue('http://localhost/api/proxy'),
  } as unknown as DiscoveryApi;
  const configApi = {
    getOptionalString: jest.fn().mockReturnValue(opts?.proxyPath),
  } as unknown as ConfigApi;
  const identityApi = {
    getCredentials: jest.fn().mockResolvedValue({ token: opts?.token }),
  } as unknown as IdentityApi;
  return new LearningPathApiClient({ discoveryApi, configApi, identityApi });
};

describe('LearningPathApiClient', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(learningPaths), { status: 200 }),
      );
  });

  afterEach(() => jest.restoreAllMocks());

  it('fetches learning paths from the default proxy path with a bearer token', async () => {
    const data = await buildClient({ token: 'tok-1' }).getLearningPathData();

    expect(data).toEqual(learningPaths);
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost/api/proxy/developer-hub/learning-paths',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok-1' }),
      }),
    );
  });

  it('uses the configured developerHub.proxyPath when set', async () => {
    await buildClient({
      proxyPath: '/custom',
      token: 'tok',
    }).getLearningPathData();

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost/api/proxy/custom/learning-paths',
      expect.anything(),
    );
  });

  it('omits the Authorization header when there is no token', async () => {
    await buildClient({}).getLearningPathData();

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('throws a descriptive error when the response is not ok', async () => {
    fetchSpy.mockResolvedValue(
      new Response('nope', { status: 500, statusText: 'Server Error' }),
    );

    await expect(
      buildClient({ token: 'tok' }).getLearningPathData(),
    ).rejects.toThrow(/status 500: Server Error/);
  });
});
