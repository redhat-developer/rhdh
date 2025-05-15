import { ErrorBoundary } from '@backstage/core-components';
import {
  AnyApiFactory,
  ApiRef,
  configApiRef,
  ProfileInfoApi,
  SessionApi,
  useApi,
  useApp,
} from '@backstage/core-plugin-api';
import {
  DefaultProviderSettings,
  ProviderSettingsItem,
  SettingsLayout,
  UserSettingsAuthProviders,
} from '@backstage/plugin-user-settings';

import Star from '@mui/icons-material/Star';
import { ProviderSetting } from '@red-hat-developer-hub/plugin-utils';

import { oidcAuthApiRef } from '../../api/AuthApiRefs';
import { GeneralPage } from './GeneralPage';

const DynamicProviderSettingsItem = ({
  title,
  description,
  provider,
}: {
  title: string;
  description: string;
  provider: string;
}) => {
  const app = useApp();
  // The provider API needs to be registered with the app
  const apiRef = app
    .getPlugins()
    .flatMap(plugin => Array.from(plugin.getApis()))
    .filter((api: AnyApiFactory) => api.api.id === provider)
    .at(0)?.api;
  if (!apiRef) {
    // eslint-disable-next-line no-console
    console.warn(
      `No API factory found for provider ref "${provider}", hiding the related provider settings UI`,
    );
    return <></>;
  }
  return (
    <ProviderSettingsItem
      title={title}
      description={description}
      apiRef={apiRef as ApiRef<ProfileInfoApi & SessionApi>}
      icon={Star}
    />
  );
};

const DynamicProviderSettings = ({
  providerSettings,
}: {
  providerSettings: ProviderSetting[];
}) => {
  const configApi = useApi(configApiRef);
  const providersConfig = configApi.getOptionalConfig('auth.providers');
  const configuredProviders = providersConfig?.keys() || [];
  return (
    <>
      <DefaultProviderSettings configuredProviders={configuredProviders} />
      {configuredProviders.includes('oidc') && (
        <ProviderSettingsItem
          title="OIDC"
          description="Provides authentication through an OIDC Provider"
          apiRef={oidcAuthApiRef}
          icon={Star}
        />
      )}
      {providerSettings.map(({ title, description, provider }) => (
        <ErrorBoundary>
          <DynamicProviderSettingsItem
            title={title}
            description={description}
            provider={provider}
          />
        </ErrorBoundary>
      ))}
    </>
  );
};

export const settingsPage = (providerSettings: ProviderSetting[]) => (
  <SettingsLayout>
    <SettingsLayout.Route path="general" title="General">
      <GeneralPage />
    </SettingsLayout.Route>
    <SettingsLayout.Route
      path="auth-providers"
      title="Authentication Providers"
    >
      <UserSettingsAuthProviders
        providerSettings={
          <DynamicProviderSettings providerSettings={providerSettings} />
        }
      />
    </SettingsLayout.Route>
  </SettingsLayout>
);
