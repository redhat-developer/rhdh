import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

import { renderInTestApp } from '@backstage/test-utils';

import DynamicRootContext, {
  MountPoints,
} from '@red-hat-developer-hub/plugin-utils';

import { ApplicationListener } from './ApplicationListener';

const MountPointProvider = ({
  mountPoints,
  children,
}: {
  mountPoints: MountPoints;
  children: ReactNode;
}) => {
  const value = useMemo(() => ({ mountPoints }), [mountPoints]);
  return (
    <DynamicRootContext.Provider value={value as any}>
      {children}
    </DynamicRootContext.Provider>
  );
};

const TestListener = () => {
  const loc = useLocation();
  return <div>{loc.pathname}</div>;
};

const TestComponent = () => {
  return <p>Hello!</p>;
};

describe('ApplicationListener', () => {
  it('should render the UI when there are no listeners', async () => {
    const mountPoints = {
      'application/listener': [],
    };
    const { getByText } = await renderInTestApp(
      <MountPointProvider mountPoints={mountPoints}>
        <ApplicationListener />
        <TestComponent />
      </MountPointProvider>,
    );
    expect(getByText('Hello!')).toBeTruthy();
  });

  it('should return the UI when the listener throws an error', async () => {
    const mountPoints = {
      'application/listener': [
        {
          Component: () => {
            throw new Error('Listener failed to render');
          },
        },
      ],
    };
    const { getByText } = await renderInTestApp(
      <MountPointProvider mountPoints={mountPoints}>
        <ApplicationListener />
        <TestComponent />
      </MountPointProvider>,
    );
    expect(getByText('Hello!')).toBeInTheDocument();
  });

  it('should render the UI when one of the listeners throw an error', async () => {
    const mountPoints = {
      'application/listener': [
        {
          Component: () => {
            throw new Error('Listener failed to render');
          },
        },
        {
          Component: TestListener,
        },
      ],
    };
    const { getByText } = await renderInTestApp(
      <MountPointProvider mountPoints={mountPoints}>
        <ApplicationListener />
        <TestComponent />
      </MountPointProvider>,
    );
    expect(getByText('Hello!')).toBeInTheDocument();
    expect(getByText('/')).toBeInTheDocument();
  });

  it('should return the UI', async () => {
    const mountPoints = {
      'application/listener': [
        {
          Component: TestListener,
        },
      ],
    };
    const { getByText } = await renderInTestApp(
      <MountPointProvider mountPoints={mountPoints}>
        <ApplicationListener />
        <TestComponent />
      </MountPointProvider>,
    );
    expect(getByText('Hello!')).toBeInTheDocument();
    expect(getByText('/')).toBeInTheDocument();
  });
});
