import {
  EntityConsumedApisCard,
  EntityProvidedApisCard,
} from '@backstage/plugin-api-docs';
import { EntitySwitch, isKind } from '@backstage/plugin-catalog';

import Grid from '../Grid';
import { isType } from '../utils';

export const ApiTabContent = () => (
  <EntitySwitch>
    <EntitySwitch.Case if={e => isType('service')(e) && isKind('component')(e)}>
      <Grid
        item
        sx={{
          gridColumn: {
            lg: '1 / span 6',
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
            lg: '7 / span 6',
            xs: '1 / -1',
          },
        }}
      >
        <EntityConsumedApisCard />
      </Grid>
    </EntitySwitch.Case>
  </EntitySwitch>
);
