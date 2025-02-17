import * as React from 'react';
import { useLocation } from 'react-router-dom';

import { render } from '@testing-library/react';

import { ApplicationListener } from './ApplicationListener';

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useContext: jest.fn(),
}));

jest.mock('react-router-dom', () => ({
  useLocation: jest.fn(() => ({
    pathname: '/test-path',
  })),
}));

const TestListener = () => {
  const loc = useLocation();
  // eslint-disable-next-line no-console
  console.log('LocationListener', loc);
  return <div>{loc.pathname}</div>;
};

const TestComponent = () => {
  return <p>Hello!</p>;
};

describe('ApplicationListener', () => {
  it('should render the UI when there are no listeners', async () => {
    (React.useContext as any).mockReturnValue({
      mountPoints: { 'application/listener': [] },
    });
    const { getByText } = render(
      <div>
        <ApplicationListener />
        <TestComponent />
      </div>,
    );
    expect(getByText('Hello!')).toBeTruthy();
  });

  it('should return the UI when the listener throws an error', async () => {
    (React.useContext as any).mockReturnValue({
      mountPoints: {
        'application/listener': [
          {
            Component: () => {
              throw new Error('Listener failed to render');
            },
          },
        ],
      },
    });
    const { getByText } = render(
      <div>
        <ApplicationListener />
        <TestComponent />
      </div>,
    );
    expect(getByText('Hello!')).toBeInTheDocument();
  });

  it('should render the UI when one of the listeners throw an error', async () => {
    (React.useContext as any).mockReturnValue({
      name: 'Context',
      mountPoints: {
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
      },
    });
    const { getByText } = render(
      <div>
        <ApplicationListener />
        <TestComponent />
      </div>,
    );
    expect(getByText('Hello!')).toBeInTheDocument();
    expect(getByText('/test-path')).toBeInTheDocument();
  });

  it('should return the UI', async () => {
    (React.useContext as any).mockReturnValue({
      name: 'Context',
      salute: 'Good day!',
      mountPoints: {
        'application/listener': [
          {
            Component: TestListener,
          },
        ],
      },
    });
    const { getByText } = render(
      <div>
        <ApplicationListener />
        <TestComponent />
      </div>,
    );
    expect(getByText('Hello!')).toBeInTheDocument();
    expect(getByText('/test-path')).toBeInTheDocument();
  });
});
