import { errorApiRef } from '@backstage/core-plugin-api';
import {
  TranslationApi,
  translationApiRef,
  TranslationSnapshot,
} from '@backstage/core-plugin-api/alpha';
import {
  MockErrorApi,
  renderWithEffects,
  TestApiProvider,
} from '@backstage/test-utils';

import { screen } from '@testing-library/react';

import { listLoadedPluginsResult } from '../../__fixtures__/listLoadedPluginsResult';
import { dynamicPluginsInfoApiRef } from '../../api/types';
import { InternalPluginsMap } from '../InternalPluginsMap';
import { DynamicPluginsTable } from './DynamicPluginsTable';

const DEFAULT_ROWS_DISPLAYED = 5;

// 6 mockapi returned external(enabled) + 53 internal(not enabled)
// mockapi returns enabled plugins
// keys from InternalPluginsMap are internal plugins
const plugins = [
  ...Object.keys(InternalPluginsMap).map(name => ({
    name,
    version: undefined,
    role: undefined,
    platform: undefined,
    internal: true,
    enabled: true,
  })),
  ...listLoadedPluginsResult,
];

// This mock simulates the translation API.
// It may be able to be removed when upstream provides a mock compatible with our usage.
const translationApiMock: Partial<TranslationApi> = {
  getTranslation: <TMessages extends { [key: string]: string }>(
    _ref: any,
  ): TranslationSnapshot<TMessages> =>
    ({
      t: (key: keyof TMessages) => key as string,
      ready: true,
    }) as TranslationSnapshot<TMessages>,

  translation$: () => ({
    subscribe: () => ({ unsubscribe: () => {}, closed: true }),
    [Symbol.observable]() {
      return this;
    },
  }),
};

describe('DynamicPluginsTable', () => {
  beforeEach(() => {
    // sort by the plugin name
    plugins.sort((a, b) => {
      return a.name.localeCompare(b.name);
    });
  });

  it('should display the plugins', async () => {
    const mockDynamicPluginApi = {
      listLoadedPlugins: async () => listLoadedPluginsResult,
    };

    const { container } = await renderWithEffects(
      <TestApiProvider
        apis={[
          [dynamicPluginsInfoApiRef, mockDynamicPluginApi],
          [translationApiRef, translationApiMock],
          [errorApiRef, new MockErrorApi()],
        ]}
      >
        <DynamicPluginsTable />
      </TestApiProvider>,
    );

    expect(
      await screen.findByText(`Plugins (${plugins.length})`),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(plugins.at(0)?.name ?? ''),
    ).toBeInTheDocument();

    const nameCells = Array.from(
      container.querySelectorAll('tbody tr > td:first-child'),
    );
    const versionCells = Array.from(
      container.querySelectorAll('tbody tr > td:nth-child(2)'),
    );
    const enabledCells = Array.from(
      container.querySelectorAll('tbody tr > td:nth-child(3)'),
    );
    const internalCells = Array.from(
      container.querySelectorAll('tbody tr > td:nth-child(4)'),
    );

    const displayedPlugins = plugins.slice(0, DEFAULT_ROWS_DISPLAYED);
    expect(nameCells.length).toBe(displayedPlugins.length);

    for (let i = 0; i < DEFAULT_ROWS_DISPLAYED; i++) {
      expect(nameCells[i].textContent).toBe(displayedPlugins[i].name);
      try {
        expect(versionCells[i].textContent).toBe(displayedPlugins[i].version);
        expect(enabledCells[i].textContent).toBe(
          displayedPlugins[i].enabled ? 'Yes' : 'No',
        );
        expect(internalCells[i].textContent).toBe(
          displayedPlugins[i].internal ? 'Yes' : 'No',
        );
      } catch (e) {
        throw new Error(`${displayedPlugins[i].name}: ${(e as Error).message}`);
      }
    }
  });
});
