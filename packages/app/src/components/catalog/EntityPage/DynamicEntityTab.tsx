import { forwardRef } from 'react';

import { Entity } from '@backstage/catalog-model';
import { Link } from '@backstage/core-components';
import { ApiHolder } from '@backstage/core-plugin-api';
import { EntityLayout, EntitySwitch } from '@backstage/plugin-catalog';

import Box from '@mui/material/Box';
import { DynamicRootConfig } from '@red-hat-developer-hub/plugin-utils';

import { useTranslation } from '../../../hooks/useTranslation';
import getDynamicRootConfig from '../../../utils/dynamicUI/getDynamicRootConfig';
import getMountPointData from '../../../utils/dynamicUI/getMountPointData';
import { getTranslatedTextWithFallback } from '../../../utils/translations';
import Grid from '../Grid';

const TranslatedTab = forwardRef<
  any,
  {
    title?: string;
    titleKey?: string;
    path?: string;
    children?: React.ReactNode;
    [key: string]: any;
  }
>((props, ref) => {
  const { title, titleKey, path, children, ...otherProps } = props;
  const { t } = useTranslation();

  const translatedText = getTranslatedTextWithFallback(t, titleKey, title);
  return (
    <Link ref={ref} to={path} {...otherProps}>
      {translatedText}
    </Link>
  );
});

export type DynamicEntityTabProps = {
  path: string;
  title: string;
  titleKey?: string;
  mountPoint: string;
  if?: (entity: Entity) => boolean;
  children?: React.ReactNode;
  priority?: number;
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
  titleKey,
  mountPoint,
  children,
  if: condition,
}: DynamicEntityTabProps) => (
  <EntityLayout.Route
    key={`${path}`}
    path={path}
    title={title}
    tabProps={{
      component: TranslatedTab,
      title: title,
      titleKey: titleKey,
      path: path,
    }}
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
