import { EntityApiDefinitionCard } from '@backstage/plugin-api-docs';
import { EntitySwitch, isKind } from '@backstage/plugin-catalog';

import Grid from '../Grid';

export const DefinitionTabContent = () => (
  <EntitySwitch>
    <EntitySwitch.Case if={isKind('api')}>
      <Grid item sx={{ gridColumn: '1 / -1' }}>
        <EntityApiDefinitionCard />
      </Grid>
    </EntitySwitch.Case>
  </EntitySwitch>
);
