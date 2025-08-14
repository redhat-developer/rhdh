import {
  EntityConsumedApisCard,
  EntityProvidedApisCard,
} from '@backstage/plugin-api-docs';
import {
  EntityDependsOnComponentsCard,
  EntityDependsOnResourcesCard,
  EntityHasSubcomponentsCard,
  EntitySwitch,
  isKind,
} from '@backstage/plugin-catalog';
import {
  Direction,
  EntityCatalogGraphCard,
} from '@backstage/plugin-catalog-graph';

import Grid from '../Grid';

export const DependenciesTabContent = () => (
  <EntitySwitch>
    <EntitySwitch.Case if={isKind('component')}>
      <Grid
        item
        sx={{
          gridColumn: {
            lg: '1 / span 6',
            xs: '1 / -1',
          },
          gridRowEnd: 'span 6',
        }}
      >
        <EntityCatalogGraphCard
          variant="gridItem"
          direction={Direction.TOP_BOTTOM}
          height={900}
        />
      </Grid>
      <Grid
        item
        sx={{
          gridColumn: {
            lg: '7 / -1',
            xs: '1 / -1',
          },
        }}
      >
        <EntityDependsOnComponentsCard variant="gridItem" />
      </Grid>
      <Grid
        item
        sx={{
          gridColumn: {
            lg: '7 / -1',
            xs: '1 / -1',
          },
        }}
      >
        <EntityDependsOnResourcesCard variant="gridItem" />
      </Grid>
      <Grid
        item
        sx={{
          gridColumn: {
            lg: '7 / -1',
            xs: '1 / -1',
          },
        }}
      >
        <EntityHasSubcomponentsCard variant="gridItem" />
      </Grid>
      <Grid
        item
        sx={{
          gridColumn: {
            lg: '7 / -1',
            xs: '1 / -1',
          },
        }}
      >
        <EntityProvidedApisCard />
      </Grid>
      <Grid
        item
        sx={{
          gridColumn: {
            lg: '7 / -1',
            xs: '1 / -1',
          },
        }}
      >
        <EntityConsumedApisCard />
      </Grid>
    </EntitySwitch.Case>
  </EntitySwitch>
);
