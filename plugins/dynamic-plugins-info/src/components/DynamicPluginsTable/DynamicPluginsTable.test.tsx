import { renderWithEffects } from '@backstage/test-utils';

import { listLoadedPluginsResult } from '../../__fixtures__/listLoadedPluginsResult';
import { DynamicPluginsTable } from './DynamicPluginsTable';

const DEFAULT_ROWS_DISPLAYED = 5;

// 6 mockapi returned external(enabled)
// mockapi returns enabled plugins
// keys from InternalPluginsMap are internal plugins
const plugins = [...listLoadedPluginsResult];

jest.mock('@backstage/core-plugin-api', () => {
  const actual = jest.requireActual('@backstage/core-plugin-api');
  return {
    ...actual,
    useApi: () => {
      return {
        listLoadedPlugins: async () => {
          return Promise.resolve(listLoadedPluginsResult);
        },
      };
    },
  };
});

describe('DynamicPluginsTable', () => {
  beforeEach(() => {
    // sort by the plugin name
    plugins.sort((a, b) => {
      return a.name.localeCompare(b.name);
    });
  });

  it('should display the plugins', async () => {
    const { findByText, container } = await renderWithEffects(
      <DynamicPluginsTable />,
    );

    expect(await findByText(`Plugins (${plugins.length})`)).toBeInTheDocument();
    expect(await findByText(plugins.at(0)?.name ?? '')).toBeInTheDocument();
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
