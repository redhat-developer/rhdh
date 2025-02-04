import * as React from 'react';

import { render } from '@testing-library/react';

import { ApplicationProvider } from './ApplicationProvider';

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useContext: jest.fn(),
}));

type ContextOneValue = {
  name: string;
};

type ContextTwoValue = {
  salute: string;
};

const TestContextOne = React.createContext<ContextOneValue>(
  {} as ContextOneValue,
);
const TestContextTwo = React.createContext<ContextTwoValue>(
  {} as ContextTwoValue,
);

const TestProviderOne = ({ children }: React.PropsWithChildren<{}>) => {
  const value = {
    name: '',
    salute: '',
  };
  return (
    <TestContextOne.Provider value={value}>{children}</TestContextOne.Provider>
  );
};

const TestProviderTwo = ({ children }: React.PropsWithChildren<{}>) => {
  const value = {
    salute: '',
  };
  return (
    <TestContextTwo.Provider value={value}>{children}</TestContextTwo.Provider>
  );
};

const TestComponent = () => {
  const contextOne = React.useContext(TestContextOne);
  const contextTwo = React.useContext(TestContextTwo);
  let helloString = `Hello ${contextOne.name ? contextOne.name : ''}!`;
  if (contextTwo.salute) {
    helloString = helloString.concat(contextTwo.salute);
  }
  return <p>{helloString}</p>;
};

describe('ApplicationProvider', () => {
  it('should return the children when there are no providers', async () => {
    (React.useContext as any).mockReturnValue({
      mountPoints: { 'application/provider': [] },
    });
    const { getByText } = render(
      <ApplicationProvider>
        <TestComponent />
      </ApplicationProvider>,
    );
    expect(getByText('Hello !')).toBeTruthy();
  });

  it('should return the children when provider throws an error', async () => {
    (React.useContext as any).mockReturnValue({
      mountPoints: {
        'application/provider': [
          {
            Component: () => {
              throw new Error('Provider failed to render');
            },
          },
        ],
      },
    });
    const { getByText } = render(
      <ApplicationProvider>
        <TestComponent />
      </ApplicationProvider>,
    );
    expect(getByText('Hello !')).toBeInTheDocument();
  });

  it('should return the children when one of the providers throw an error', async () => {
    (React.useContext as any).mockReturnValue({
      name: 'Context',
      mountPoints: {
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
      },
    });
    const { getByText } = render(
      <ApplicationProvider>
        <TestComponent />
      </ApplicationProvider>,
    );
    expect(getByText('Hello Context!')).toBeInTheDocument();
  });

  it('should return the children', async () => {
    (React.useContext as any).mockReturnValue({
      name: 'Context',
      salute: 'Good day!',
      mountPoints: {
        'application/provider': [
          {
            Component: TestProviderOne,
          },
          {
            Component: TestProviderTwo,
          },
        ],
      },
    });
    const { getByText } = render(
      <ApplicationProvider>
        <TestComponent />
      </ApplicationProvider>,
    );
    expect(getByText('Hello Context!Good day!')).toBeInTheDocument();
  });
});
