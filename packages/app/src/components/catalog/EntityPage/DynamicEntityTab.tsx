import { Entity } from '@backstage/catalog-model';
import { ApiHolder } from '@backstage/core-plugin-api';
import { EntityLayout, EntitySwitch } from '@backstage/plugin-catalog';

import Box from '@mui/material/Box';

import getDynamicRootConfig from '../../../utils/dynamicUI/getDynamicRootConfig';
import getMountPointData from '../../../utils/dynamicUI/getMountPointData';
import { DynamicRootConfig } from '../../DynamicRoot/DynamicRootContext';
import Grid from '../Grid';

export type DynamicEntityTabProps = {
  path: string;
  title: string;
  mountPoint: string;
  if?: (entity: Entity) => boolean;
  children?: React.ReactNode;
};

/**
 * Returns an configured route element suitable to use within an
 * EntityLayout component that will load content based on the dynamic
 * route and mount point configuration.  Accepts a {@link DynamicEntityTabProps}
 * Note - only call this as a function from within an EntityLayout
 * component
 * @param param0
 * @returns
 */
export const dynamicEntityTab = ({
  path,
  title,
  mountPoint,
  children,
  if: condition,
}: DynamicEntityTabProps) => (
  <EntityLayout.Route
    key={`${path}`}
    path={path}
    title={title}
    if={entity =>
      (condition
        ? errorWrappedCondition(
            `route path ${path} and title ${title}`,
            condition,
          )(entity)
        : Boolean(children)) ||
      getMountPointData<React.ComponentType>(`${mountPoint}/cards`)
        .flatMap(({ config }) => config.if)
        .some(cond =>
          errorWrappedCondition(
            `route path ${path} and title ${title}`,
            cond,
          )(entity),
        )
    }
  >
    {getMountPointData<React.ComponentType<React.PropsWithChildren>>(
      `${mountPoint}/context`,
    ).reduce(
      (acc, { Component }) => (
        <Component>{acc}</Component>
      ),
      <Grid container>
        {children}
        {getMountPointData<
          React.ComponentType<React.PropsWithChildren>,
          React.ReactNode | ((config: DynamicRootConfig) => React.ReactNode)
        >(`${mountPoint}/cards`).map(
          ({ Component, config, staticJSXContent }, index) => {
            return (
              <EntitySwitch key={`${Component.displayName}-${index}`}>
                <EntitySwitch.Case
                  if={(entity, context) =>
                    errorWrappedCondition(
                      `route path ${path}, title ${title} and mountPoint ${mountPoint}/cards`,
                      config.if,
                    )(entity, context)
                  }
                >
                  <Box sx={config.layout}>
                    <Component {...config.props}>
                      {typeof staticJSXContent === 'function'
                        ? staticJSXContent(getDynamicRootConfig())
                        : staticJSXContent}
                    </Component>
                  </Box>
                </EntitySwitch.Case>
              </EntitySwitch>
            );
          },
        )}
      </Grid>,
    )}
  </EntityLayout.Route>
);

function errorWrappedCondition(
  evaluationContext: string,
  condition: (entity: Entity, context?: { apis: ApiHolder }) => boolean,
): (entity: Entity, context?: { apis: ApiHolder }) => boolean {
  return (entity: Entity, context?: { apis: ApiHolder }) => {
    try {
      return condition(entity, context);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(
        `Error evaluating conditional expression for ${evaluationContext}: `,
        error,
      );
    }
    return false;
  };
}
