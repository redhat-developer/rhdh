import { useState } from 'react';

import {
  ResponseErrorPanel,
  Table,
  TableColumn,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';

import { Query, QueryResult } from '@material-table/core';

import { DynamicPluginInfo, dynamicPluginsInfoApiRef } from '../../api/types';
import {
  getNotEnabledInternalPlugins,
  InternalPluginsMap,
} from '../InternalPluginsMap';

export const DynamicPluginsTable = () => {
  const [error, setError] = useState<Error | undefined>(undefined);
  const [count, setCount] = useState<number>(0);
  const dynamicPluginInfo = useApi(dynamicPluginsInfoApiRef);
  let data: DynamicPluginInfo[] = [];
  const columns: TableColumn<DynamicPluginInfo>[] = [
    {
      title: 'Name',
      field: 'name',
      defaultSort: 'asc',
    },
    {
      title: 'Version',
      field: 'version',
      width: '15%',
    },
    {
      title: 'Enabled',
      field: 'enabled',
      render: ({ enabled }) => <>{enabled ? 'Yes' : 'No'}</>,
      width: '10%',
    },
    {
      title: 'Preinstalled',
      field: 'internal',
      render: ({ internal }) => <>{internal ? 'Yes' : 'No'}</>,
      width: '10%',
    },
    {
      title: 'Role',
      render: ({ platform, role }) => (
        <>{(role && `${role} (${platform})`) || null}</>
      ),
      sorting: false,
    },
  ];
  const fetchData = async (
    query: Query<DynamicPluginInfo>,
  ): Promise<QueryResult<DynamicPluginInfo>> => {
    const {
      orderBy = { field: 'name' },
      orderDirection = 'asc',
      page = 0,
      pageSize = 5,
      search = '',
    } = query || {};
    try {
      // for now sorting/searching/pagination is handled client-side
      const enabledPlugins = (await dynamicPluginInfo.listLoadedPlugins()).map(
        plugin => {
          if (plugin.name in InternalPluginsMap) {
            return {
              ...plugin,
              internal: true,
              enabled: true,
            };
          }
          return {
            ...plugin,
            enabled: true,
          };
        },
      );
      const notEnabledInternalPlugins = getNotEnabledInternalPlugins(
        enabledPlugins.map(plugin => plugin.name),
      );
      data = [...enabledPlugins]
        // add other internal plugins that are not enabled
        .concat(notEnabledInternalPlugins)
        .sort(
          (
            a: Record<string, string | boolean>,
            b: Record<string, string | boolean>,
          ) => {
            const field = orderBy.field!;
            const orderMultiplier = orderDirection === 'desc' ? -1 : 1;

            if (a[field] === null || b[field] === null) {
              return 0;
            }

            // Handle boolean values separately
            if (
              typeof a[field] === 'boolean' &&
              typeof b[field] === 'boolean'
            ) {
              return (a[field] ? 1 : -1) * orderMultiplier;
            }

            return (
              (a[field] as string).localeCompare(b[field] as string) *
              orderMultiplier
            );
          },
        )
        .filter(plugin =>
          plugin.name
            .toLowerCase()
            .trim()
            .includes(search.toLowerCase().trim()),
        );
      const totalCount = data.length;
      let start = 0;
      let end = totalCount;
      if (totalCount > pageSize) {
        start = page * pageSize;
        end = start + pageSize;
      }
      setCount(totalCount);
      return { data: data.slice(start, end), page, totalCount };
    } catch (loadingError) {
      // eslint-disable-next-line no-console
      console.error('Failed to load plugins', loadingError);
      setError(loadingError as Error);
      return { data: [], totalCount: 0, page: 0 };
    }
  };
  if (error) {
    return <ResponseErrorPanel error={error} />;
  }
  return (
    <Table
      title={`Plugins (${count})`}
      options={{
        draggable: false,
        filtering: false,
        sorting: true,
        paging: true,
        thirdSortClick: false,
        debounceInterval: 500,
      }}
      columns={columns}
      data={fetchData}
    />
  );
};
