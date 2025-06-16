import {
  createContext,
  PropsWithChildren,
  ReactNode,
  useContext,
  useMemo,
} from 'react';

import { renderInTestApp } from '@backstage/test-utils';

import DynamicRootContext, {
  MountPoints,
} from '@red-hat-developer-hub/plugin-utils';

import { ApplicationProvider } from './ApplicationProvider';

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

type ContextOneValue = {
  name: string;
};

type ContextTwoValue = {
  salute: string;
};

const TestContextOne = createContext<ContextOneValue>({} as ContextOneValue);

const TestContextTwo = createContext<ContextTwoValue>({} as ContextTwoValue);

const TestProviderOne = ({ children }: PropsWithChildren<{}>) => {
  const value = useMemo(() => ({ name: 'Context' }), []);
  return (
    <TestContextOne.Provider value={value}>{children}</TestContextOne.Provider>
  );
};

const TestProviderTwo = ({ children }: PropsWithChildren<{}>) => {
  const value = useMemo(() => ({ salute: 'Good day!' }), []);
  return (
    <TestContextTwo.Provider value={value}>{children}</TestContextTwo.Provider>
  );
};

const TestComponent = () => {
  const contextOne = useContext(TestContextOne);
  const contextTwo = useContext(TestContextTwo);
  let helloString = `Hello ${contextOne.name ? contextOne.name : ''}!`;
  if (contextTwo.salute) {
    helloString = helloString.concat(contextTwo.salute);
  }
  return <p>{helloString}</p>;
};

describe('ApplicationProvider', () => {
  it('should return the children when there are no providers', async () => {
    const mountPoints = {
      'application/provider': [],
    };
    const { getByText } = await renderInTestApp(
      <MountPointProvider mountPoints={mountPoints}>
        <ApplicationProvider>
          <TestComponent />
        </ApplicationProvider>
      </MountPointProvider>,
    );
    expect(getByText('Hello !')).toBeTruthy();
  });

  it('should return the children when provider throws an error', async () => {
    const mountPoints = {
      'application/provider': [
        {
          Component: () => {
            throw new Error('Provider failed to render');
          },
        },
      ],
    };
    const { getByText } = await renderInTestApp(
      <MountPointProvider mountPoints={mountPoints}>
        <ApplicationProvider>
          <TestComponent />
        </ApplicationProvider>
      </MountPointProvider>,
    );
    expect(getByText('Hello !')).toBeInTheDocument();
  });

  it('should return the children when one of the providers throw an error', async () => {
    const mountPoints = {
      'application/provider': [
        {
          Component: () => {
            throw new Error('Provider failed to render');
          },
        },
        {
          Component: TestProviderOne,
        },
      ],
    };
    const { getByText } = await renderInTestApp(
      <MountPointProvider mountPoints={mountPoints}>
        <ApplicationProvider>
          <TestComponent />
        </ApplicationProvider>
      </MountPointProvider>,
    );
    expect(getByText('Hello Context!')).toBeInTheDocument();
  });

  it('should return the children', async () => {
    const mountPoints = {
      'application/provider': [
        {
          Component: TestProviderOne,
        },
        {
          Component: TestProviderTwo,
        },
      ],
    };
    const { getByText } = await renderInTestApp(
      <MountPointProvider mountPoints={mountPoints}>
        <ApplicationProvider>
          <TestComponent />
        </ApplicationProvider>
      </MountPointProvider>,
    );
    expect(getByText('Hello Context!Good day!')).toBeInTheDocument();
  });
});
