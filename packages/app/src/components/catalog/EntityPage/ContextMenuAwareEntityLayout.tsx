import {
  ComponentType,
  PropsWithChildren,
  ReactNode,
  useMemo,
  useState,
} from 'react';

import { EntityLayout } from '@backstage/plugin-catalog';

import getMountPointData from '../../../utils/dynamicUI/getMountPointData';
import { MenuIcon } from '../../Root/MenuIcon';

const makeIcon = (iconName: string) => () => <MenuIcon icon={iconName} />;

export const ContextMenuAwareEntityLayout = (props: {
  children?: ReactNode;
}) => {
  const contextMenuElements =
    getMountPointData<ComponentType<PropsWithChildren<any>>>(
      `entity.context.menu`,
    );

  const [openStates, setOpenStates] = useState(
    new Array<boolean>(contextMenuElements.length).fill(false),
  );

  const changeValueAt = (
    values: boolean[],
    index: number,
    newValue: boolean,
  ): boolean[] => values.map((v, i) => (i === index ? newValue : v));

  const extraMenuItems = useMemo(
    () =>
      contextMenuElements.map((e, index) => {
        const Icon = makeIcon(e.config.props?.icon ?? 'icon');
        return {
          title: e.config.props?.title ?? '<title>',
          Icon,
          onClick: () => {
            setOpenStates(changeValueAt(openStates, index, true));
          },
        };
      }),
    [contextMenuElements, openStates],
  );

  return (
    <>
      <EntityLayout
        UNSTABLE_extraContextMenuItems={extraMenuItems}
        UNSTABLE_contextMenuOptions={{
          disableUnregister: 'visible',
        }}
      >
        {props.children}
      </EntityLayout>
      {contextMenuElements.map(({ Component }, index) => (
        <Component
          key={`entity.context.menu-${Component.displayName}`}
          open={openStates[index]}
          onClose={() => setOpenStates(changeValueAt(openStates, index, false))}
        />
      ))}
    </>
  );
};
