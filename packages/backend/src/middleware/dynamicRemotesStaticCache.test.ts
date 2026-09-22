import type { Request, Response } from 'express';

import {
  DYNAMIC_REMOTES_STATIC_CACHE_CONTROL,
  dynamicRemotesStaticCacheMiddleware,
} from './dynamicRemotesStaticCache';

function runMiddleware(path: string) {
  const req = { path } as Request;
  const headers: Record<string, string> = {};
  const res = {
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
  } as unknown as Response;
  const next = jest.fn();

  dynamicRemotesStaticCacheMiddleware(req, res, next);

  return { headers, next, setHeader: res.setHeader as jest.Mock };
}

describe('dynamicRemotesStaticCacheMiddleware', () => {
  it.each([
    '/.backstage/dynamic-features/remotes/plugin-example-dynamic/static/1234.abcd.js',
    '/.backstage/dynamic-features/remotes/@red-hat-developer-hub/backstage-plugin-adoption-insights-dynamic/static/__federation_expose_adoption_insights_translations_module.9e8b11a9.chunk.js',
  ])('sets aggressive Cache-Control for remotes static assets: %s', path => {
    const { headers, next, setHeader } = runMiddleware(path);

    expect(setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      DYNAMIC_REMOTES_STATIC_CACHE_CONTROL,
    );
    expect(headers['Cache-Control']).toBe('public, max-age=1209600');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    '/.backstage/dynamic-features/remotes/plugin-example-dynamic/remoteEntry.js',
    '/.backstage/dynamic-features/remotes/@red-hat-developer-hub/backstage-plugin-adoption-insights-dynamic/remoteEntry.js',
    '/.backstage/dynamic-features/remotes/plugin-example-dynamic/mf-manifest.json',
    '/.backstage/dynamic-features/remotes/@red-hat-developer-hub/backstage-plugin-adoption-insights-dynamic/mf-manifest.json',
    '/static/main.js',
  ])('does not set Cache-Control for %s', path => {
    const { setHeader, next } = runMiddleware(path);

    expect(setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
