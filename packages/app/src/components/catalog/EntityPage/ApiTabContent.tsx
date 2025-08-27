import {
  EntityConsumedApisCard,
  EntityProvidedApisCard,
} from '@backstage/plugin-api-docs';
import { EntitySwitch, isKind } from '@backstage/plugin-catalog';

import { isType } from '@red-hat-developer-hub/app-utils';

import Grid from '../Grid';

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
