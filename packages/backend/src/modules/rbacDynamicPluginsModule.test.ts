import {
  DynamicPluginProvider,
  dynamicPluginsServiceRef,
} from '@backstage/backend-dynamic-feature-service';
import { createServiceFactory } from '@backstage/backend-plugin-api';
import { ServiceFactoryTester } from '@backstage/backend-test-utils';

import { pluginIDProviderService } from './rbacDynamicPluginsModule';

const pkg = (name: string, role = 'backend-plugin') => ({
  manifest: { name, backstage: { role } },
});

const dynamicPluginsWith = (availablePackages: unknown[]) =>
  createServiceFactory({
    service: dynamicPluginsServiceRef,
    deps: {},
    async factory() {
      return { availablePackages } as unknown as DynamicPluginProvider;
    },
  });

const resolvePluginIds = async (availablePackages: unknown[]) => {
  const tester = ServiceFactoryTester.from(pluginIDProviderService, {
    dependencies: [dynamicPluginsWith(availablePackages)],
  });
  const provider = await tester.getSubject();
  return provider.getPluginIds();
};

describe('pluginIDProviderService', () => {
  it('always exposes the core plugin ids', async () => {
    expect(await resolvePluginIds([])).toEqual([
      'catalog',
      'scaffolder',
      'permission',
    ]);
  });

  it('normalizes backend dynamic plugin package names across naming styles', async () => {
    const ids = await resolvePluginIds([
      pkg('@backstage/plugin-foo-backend-dynamic'),
      pkg('backstage-plugin-bar-backend-dynamic'),
      pkg('@redhat/backstage-plugin-baz-backend-dynamic'),
      pkg('custom-plugin-qux-backend-dynamic'),
    ]);

    expect(ids).toEqual([
      'catalog',
      'scaffolder',
      'permission',
      'foo',
      'bar',
      'baz',
      'qux',
    ]);
  });

  it('ignores packages that are not backend plugins', async () => {
    const ids = await resolvePluginIds([
      pkg('@backstage/plugin-frontend-dynamic', 'frontend-plugin'),
      { manifest: { name: 'no-role-plugin' } },
    ]);

    expect(ids).toEqual(['catalog', 'scaffolder', 'permission']);
  });
});
