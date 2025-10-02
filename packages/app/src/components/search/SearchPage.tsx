import { CatalogIcon, Content, Header, Page } from '@backstage/core-components';
import { CatalogSearchResultListItem } from '@backstage/plugin-catalog';
import { SearchType } from '@backstage/plugin-search';
import {
  SearchBar,
  SearchFilter,
  SearchPagination,
  SearchResult,
} from '@backstage/plugin-search-react';

import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import { makeStyles } from 'tss-react/mui';

import { useTranslation } from '../../hooks/useTranslation';
import getMountPointData from '../../utils/dynamicUI/getMountPointData';
import { MenuIcon } from '../Root/MenuIcon';

const useStyles = makeStyles()(theme => ({
  searchBar: {
    borderRadius: '50px',
    margin: 'auto',
    boxShadow: theme.shadows.at(1),
  },
  filters: {
    padding: theme.spacing(2),
    gap: theme.spacing(2.5),
    marginTop: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column',
  },
  notchedOutline: {
    borderStyle: 'none!important',
  },
}));

export const SearchPage = () => {
  const { classes } = useStyles();
  const { t } = useTranslation();

  return (
    <Page themeId="home">
      <Header title={t('app.search.title')} />
      <Content>
        <Grid container direction="row">
          <Grid item xs={12}>
            {/* useStyles has a lower precedence over mui styles hence why we need use use css */}
            <SearchBar
              InputProps={{
                classes: {
                  notchedOutline: classes.notchedOutline,
                },
              }}
              className={classes.searchBar}
            />
          </Grid>
          <Grid item xs={3}>
            <SearchType.Accordion
              name={t('app.search.resultType')}
              defaultValue="software-catalog"
              types={[
                {
                  value: 'software-catalog',
                  name: t('app.search.softwareCatalog'),
                  icon: <CatalogIcon />,
                },
                ...getMountPointData<
                  (
                    name: string,
                    icon: React.ReactElement,
                  ) => {
                    name: string;
                    icon: React.ReactElement;
                    value: string;
                  }
                >('search.page.types').map(
                  ({ Component: getSearchType, config: { props } }) =>
                    getSearchType(
                      props?.name || '',
                      <MenuIcon icon={props?.icon || ''} />,
                    ),
                ),
              ]}
            />
            <Paper className={classes.filters}>
              <SearchFilter.Select
                label={t('app.search.filters.kind')}
                name="kind"
                values={[
                  t('app.search.filters.component'),
                  t('app.search.filters.template'),
                ]}
              />
              <SearchFilter.Checkbox
                label={t('app.search.filters.lifecycle')}
                name="lifecycle"
                values={[
                  t('app.search.filters.experimental'),
                  t('app.search.filters.production'),
                ]}
              />
              {...getMountPointData<React.ComponentType>(
                'search.page.filters',
              ).map(({ Component, config }, idx) => {
                return (
                  <Component
                    key={`search_filter_${config?.props?.name || idx}`}
                    {...config.props}
                  />
                );
              })}
            </Paper>
          </Grid>
          <Grid item xs={9}>
            <SearchPagination />
            <SearchResult>
              <CatalogSearchResultListItem icon={<CatalogIcon />} />
              {getMountPointData<React.ComponentType>(
                'search.page.results',
              ).map(({ Component, config }, idx) => {
                const ComponentWithIcon = Component as React.FunctionComponent<{
                  icon: React.ReactElement;
                }>;
                return (
                  <ComponentWithIcon
                    {...config.props}
                    key={`search_results_${config?.props?.name || idx}`}
                    icon={<MenuIcon icon={config.props?.icon || ''} />}
                  />
                );
              })}
            </SearchResult>
          </Grid>
        </Grid>
      </Content>
    </Page>
  );
};
