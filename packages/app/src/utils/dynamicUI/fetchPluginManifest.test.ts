// javascript
const { installFetchManifestHandler } = require('./fetchPluginManifest');

describe('installFetchManifestHandler (missing manifest message)', () => {
  beforeEach(() => {
    if (typeof global.window === 'undefined') {
      Object.defineProperty(global, 'window', {
        value: { fetch: jest.fn(), location: { origin: 'http://localhost' } },
        configurable: true,
        writable: true,
      });
    } else {
      global.window.fetch = jest.fn();
      global.window.location = { origin: 'http://localhost' };
    }

    if (typeof global.Response === 'undefined') {
      Object.defineProperty(global, 'Response', {
        configurable: true,
        value: class {
          constructor(body, init) {
            this._body = body;
            this.status =
              init && typeof init.status !== 'undefined' ? init.status : 200;
            this.headers = init && init.headers ? init.headers : {};
          }
          async json() {
            return JSON.parse(this._body);
          }
          async text() {
            return this._body;
          }
        },
      });
    }
  });

  // afterEach(() => {
  //   jest.resetAllMocks();
  //   const wDesc = Object.getOwnPropertyDescriptor(global, 'window');
  //   if (wDesc && wDesc.configurable) delete global.window;
  //   const rDesc = Object.getOwnPropertyDescriptor(global, 'Response');
  //   if (rDesc && rDesc.configurable) delete global.Response;
  // });
  afterEach(() => {
    jest.resetAllMocks();

    const wDesc = Object.getOwnPropertyDescriptor(global, 'window');
    if (wDesc && wDesc.configurable) {
      // @ts-ignore - runtime allows deletion; TS types may mark it readonly
      delete (global as any).window;
    }

    const rDesc = Object.getOwnPropertyDescriptor(global, 'Response');
    if (rDesc && rDesc.configurable) {
      // @ts-ignore
      delete (global as any).Response;
    }
  });

  it('returns a 404 JSON response mentioning "my-plugin" when original fetch returns 404', async () => {
    const manifestUrl =
      'http://localhost/assets/my-plugin/plugin-manifest.json';

    global.window.fetch = jest.fn().mockResolvedValue({
      status: 404,
      async json() {
        return {};
      },
    });

    installFetchManifestHandler();

    const res = await global.window.fetch(manifestUrl);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body._missingManifest).toBe(true);
    expect(body.message).toContain('my-plugin');
  });

  it('returns a 404 JSON response mentioning "Plugin manifest for my-plugin not found" when original fetch throws', async () => {
    const manifestUrl =
      'http://localhost/assets/my-plugin/plugin-manifest.json';

    global.window.fetch = jest.fn().mockRejectedValue(new Error('network'));

    installFetchManifestHandler();

    const res = await global.window.fetch(manifestUrl);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body._missingManifest).toBe(true);
    expect(body.message).toContain('Plugin manifest for my-plugin not found');
  });
});
