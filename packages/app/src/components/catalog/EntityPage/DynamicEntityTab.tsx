import { Entity } from '@backstage/catalog-model';
import { ApiHolder } from '@backstage/core-plugin-api';
import { EntityLayout, EntitySwitch } from '@backstage/plugin-catalog';
import { TechDocsAddons } from '@backstage/plugin-techdocs-react';

import Box from '@mui/material/Box';

import getMountPointData from '../../../utils/dynamicUI/getMountPointData';
import getTechDocsExtensionsData from '../../../utils/dynamicUI/getTechDocsExtentionsData';
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
          React.ReactNode
        >(`${mountPoint}/cards`).map(
          ({ Component, config, staticJSXContent, importName }, index) => {
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
                      {importName === 'EntityTechdocsContent' ? (
                        <TechDocsAddons>
                          {getTechDocsExtensionsData<
                            React.ComponentType<React.PropsWithChildren>
                          >().map(
                            ({
                              scope,
                              module,
                              importName: techdocsImportName,
                              Component: TechdocsComponent,
                            }) => (
                              <TechdocsComponent
                                key={`${scope}-${module}-${techdocsImportName}`}
                              />
                            ),
                          )}
                        </TechDocsAddons>
                      ) : (
                        staticJSXContent
                      )}
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
