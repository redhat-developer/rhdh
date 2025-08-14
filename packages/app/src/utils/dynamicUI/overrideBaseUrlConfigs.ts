import { AppConfig, ConfigReader } from '@backstage/config';

function createLocalBaseUrl(fullUrl: string): string {
  const url = new URL(fullUrl);
  url.protocol = document.location.protocol;
  url.hostname = document.location.hostname;
  url.port = document.location.port;
  return url.toString().replace(/\/$/, '');
}

function overrideBaseUrlConfigs(inputConfigs: AppConfig[]): AppConfig[] {
  const urlConfigReader = ConfigReader.fromConfigs(inputConfigs);

  // In tests we may not have `app.baseUrl` or `backend.baseUrl`, to keep them optional
  const appBaseUrl = urlConfigReader.getOptionalString('app.baseUrl');
  const backendBaseUrl = urlConfigReader.getOptionalString('backend.baseUrl');

  let configs = inputConfigs;

  let newBackendBaseUrl: string | undefined = undefined;
  let newAppBaseUrl: string | undefined = undefined;

  if (appBaseUrl && backendBaseUrl) {
    const appOrigin = new URL(appBaseUrl).origin;
    const backendOrigin = new URL(backendBaseUrl).origin;

    if (appOrigin === backendOrigin) {
      const maybeNewBackendBaseUrl = createLocalBaseUrl(backendBaseUrl);
      if (backendBaseUrl !== maybeNewBackendBaseUrl) {
        newBackendBaseUrl = maybeNewBackendBaseUrl;
      }
    }
  }

  if (appBaseUrl) {
    const maybeNewAppBaseUrl = createLocalBaseUrl(appBaseUrl);
    if (appBaseUrl !== maybeNewAppBaseUrl) {
      newAppBaseUrl = maybeNewAppBaseUrl;
    }
  }

  // Only add the relative config if there is actually data to add.
  if (newAppBaseUrl || newBackendBaseUrl) {
    configs = configs.concat({
      data: {
        app: newAppBaseUrl && {
          baseUrl: newAppBaseUrl,
        },
        backend: newBackendBaseUrl && {
          baseUrl: newBackendBaseUrl,
        },
      },
      context: 'relative-resolver',
    });
  }

  return configs;
}

export default overrideBaseUrlConfigs;
