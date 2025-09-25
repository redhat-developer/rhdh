import { mockServices } from '@backstage/backend-test-utils';

import express from 'express';
import request from 'supertest';

import fs from 'fs';

import { createRouter } from './router';

jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
  };
});

describe('createRouter', () => {
  let app: express.Express;
  let mockConfig: any;

  beforeEach(async () => {
    mockConfig = mockServices.rootConfig({
      data: {
        i18n: {
          locales: ['en', 'de'],
          overrides: ['/tmp/en.json', '/tmp/de.json'],
        },
      },
    });

    const router = await createRouter({
      logger: mockServices.logger.mock(),
      config: mockConfig,
    });

    app = express();
    app.use('/', router);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should return merged translations when multiple files exist', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
      if (filePath === '/tmp/en.json') {
        return JSON.stringify({ plugin: { en: { hello: 'world' } } });
      }
      if (filePath === '/tmp/de.json') {
        return JSON.stringify({ plugin: { de: { hello: 'welt' } } });
      }
      return '{}';
    });

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      plugin: {
        en: { hello: 'world' },
        de: { hello: 'welt' },
      },
    });
  });

  it('should return 404 if no valid files exist', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const res = await request(app).get('/');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain(
      'No valid translation overrides found in the provided files',
    );
  });

  it('should skip invalid JSON files', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({ notAPluginKey: 'just a string' }),
    );

    const res = await request(app).get('/');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain(
      'No valid translation overrides found in the provided files',
    );
  });

  it('should return 500 if transalation json file is invalid', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockImplementation(() => {
      throw new Error('boom');
    });

    const res = await request(app).get('/');

    expect(res.status).toBe(500);
    expect(res.body.error).toContain(
      'Failed to process translation override files',
    );
  });

  it('should filter out translations not in configured locales', async () => {
    mockConfig = mockServices.rootConfig({
      data: {
        i18n: {
          overrides: ['/tmp/en.json', '/tmp/de.json'],
          locales: ['en'],
        },
      },
    });

    const router = await createRouter({
      logger: mockServices.logger.mock(),
      config: mockConfig,
    });

    app = express();
    app.use('/', router);

    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
      if (filePath === '/tmp/en.json') {
        return JSON.stringify({ plugin: { en: { hello: 'world' } } });
      }
      if (filePath === '/tmp/de.json') {
        return JSON.stringify({ plugin: { de: { hello: 'welt' } } });
      }
      return '{}';
    });

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      plugin: {
        en: { hello: 'world' },
      },
    });
  });

  it('should return empty object if locales in the override translations are not configured in app-config', async () => {
    mockConfig = mockServices.rootConfig({
      data: {
        i18n: {
          overrides: ['/tmp/de.json'],
          locales: ['en'],
        },
      },
    });

    const router = await createRouter({
      logger: mockServices.logger.mock(),
      config: mockConfig,
    });

    app = express();
    app.use('/', router);

    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockImplementation(_filePath =>
      JSON.stringify({ plugin: { de: { hello: 'welt' } } }),
    );

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });
});
