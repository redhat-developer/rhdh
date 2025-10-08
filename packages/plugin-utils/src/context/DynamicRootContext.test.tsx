import React from 'react';

import { render, screen } from '@testing-library/react';

import { ComponentRegistry } from '../types';
import { DynamicRootContext } from './DynamicRootContext';

describe('DynamicRootContext', () => {
  it('should provide default values', () => {
    const TestComponent = () => {
      const context = React.useContext(DynamicRootContext);

      return (
        <div>
          <div data-testid="app-provider">
            {typeof context.AppProvider === 'function'
              ? 'function'
              : 'not-function'}
          </div>
          <div data-testid="app-router">
            {typeof context.AppRouter === 'function'
              ? 'function'
              : 'not-function'}
          </div>
          <div data-testid="routes-length">{context.dynamicRoutes.length}</div>
          <div data-testid="menu-items-length">{context.menuItems.length}</div>
          <div data-testid="mount-points-keys">
            {Object.keys(context.mountPoints).length}
          </div>
          <div data-testid="entity-tab-overrides-keys">
            {Object.keys(context.entityTabOverrides).length}
          </div>
          <div data-testid="provider-settings-length">
            {context.providerSettings.length}
          </div>
          <div data-testid="scaffolder-extensions-length">
            {context.scaffolderFieldExtensions.length}
          </div>
          <div data-testid="techdocs-addons-length">
            {context.techdocsAddons.length}
          </div>
        </div>
      );
    };

    render(<TestComponent />);

    expect(screen.getByTestId('app-provider')).toHaveTextContent('function');
    expect(screen.getByTestId('app-router')).toHaveTextContent('function');
    expect(screen.getByTestId('routes-length')).toHaveTextContent('0');
    expect(screen.getByTestId('menu-items-length')).toHaveTextContent('0');
    expect(screen.getByTestId('mount-points-keys')).toHaveTextContent('0');
    expect(screen.getByTestId('entity-tab-overrides-keys')).toHaveTextContent(
      '0',
    );
    expect(screen.getByTestId('provider-settings-length')).toHaveTextContent(
      '0',
    );
    expect(
      screen.getByTestId('scaffolder-extensions-length'),
    ).toHaveTextContent('0');
    expect(screen.getByTestId('techdocs-addons-length')).toHaveTextContent('0');
  });

  it('should provide custom values when wrapped with provider', () => {
    const customValue: ComponentRegistry = {
      AppProvider: ({ children }) => (
        <div className="custom-app-provider">{children}</div>
      ),
      AppRouter: ({ children }) => (
        <div className="custom-app-router">{children}</div>
      ),
      dynamicRoutes: [
        {
          scope: 'test',
          module: 'TestModule',
          path: '/test',
          Component: () => <div>Test Route</div>,
          config: { props: {} },
        },
      ],
      entityTabOverrides: {
        'test-tab': {
          title: 'Test Tab',
          mountPoint: 'test-mount',
        },
      },
      mountPoints: {
        'test-mount': [
          {
            Component: ({ children }) => <div>{children}</div>,
          },
        ],
      },
      menuItems: [
        {
          name: 'test-menu',
          title: 'Test Menu',
        },
      ],
      providerSettings: [
        {
          title: 'Test Provider',
          description: 'Test description',
          provider: 'test',
        },
      ],
      scaffolderFieldExtensions: [
        {
          scope: 'test',
          module: 'TestField',
          importName: 'TestField',
          Component: () => null,
        },
      ],
      techdocsAddons: [
        {
          scope: 'test',
          module: 'TestAddon',
          importName: 'TestAddon',
          Component: () => null,
          config: { props: {} },
        },
      ],
      translationRefs: [],
    };

    const TestComponent = () => {
      const context = React.useContext(DynamicRootContext);

      return (
        <div>
          <div data-testid="routes-length">{context.dynamicRoutes.length}</div>
          <div data-testid="first-route-scope">
            {context.dynamicRoutes[0]?.scope || 'no-scope'}
          </div>
          <div data-testid="menu-items-length">{context.menuItems.length}</div>
          <div data-testid="first-menu-name">
            {context.menuItems[0]?.name || 'no-name'}
          </div>
          <div data-testid="mount-points-keys">
            {Object.keys(context.mountPoints).join(',')}
          </div>
          <div data-testid="entity-tab-overrides-keys">
            {Object.keys(context.entityTabOverrides).join(',')}
          </div>
          <div data-testid="provider-settings-length">
            {context.providerSettings.length}
          </div>
          <div data-testid="scaffolder-extensions-length">
            {context.scaffolderFieldExtensions.length}
          </div>
          <div data-testid="techdocs-addons-length">
            {context.techdocsAddons.length}
          </div>
        </div>
      );
    };

    render(
      <DynamicRootContext.Provider value={customValue}>
        <TestComponent />
      </DynamicRootContext.Provider>,
    );

    expect(screen.getByTestId('routes-length')).toHaveTextContent('1');
    expect(screen.getByTestId('first-route-scope')).toHaveTextContent('test');
    expect(screen.getByTestId('menu-items-length')).toHaveTextContent('1');
    expect(screen.getByTestId('first-menu-name')).toHaveTextContent(
      'test-menu',
    );
    expect(screen.getByTestId('mount-points-keys')).toHaveTextContent(
      'test-mount',
    );
    expect(screen.getByTestId('entity-tab-overrides-keys')).toHaveTextContent(
      'test-tab',
    );
    expect(screen.getByTestId('provider-settings-length')).toHaveTextContent(
      '1',
    );
    expect(
      screen.getByTestId('scaffolder-extensions-length'),
    ).toHaveTextContent('1');
    expect(screen.getByTestId('techdocs-addons-length')).toHaveTextContent('1');
  });

  it('should render default AppProvider and AppRouter as null', () => {
    const TestComponent = () => {
      const context = React.useContext(DynamicRootContext);
      const AppProvider = context.AppProvider;
      const AppRouter = context.AppRouter;

      return (
        <div>
          <AppProvider>
            <div data-testid="app-provider-content">Provider Content</div>
          </AppProvider>
          <AppRouter>
            <div data-testid="app-router-content">Router Content</div>
          </AppRouter>
        </div>
      );
    };

    const { container } = render(<TestComponent />);

    // Default AppProvider and AppRouter return null, so children won't render
    expect(
      container.querySelector('[data-testid="app-provider-content"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="app-router-content"]'),
    ).toBeNull();
  });

  it('should render custom AppProvider and AppRouter', () => {
    const customValue: ComponentRegistry = {
      AppProvider: ({ children }) => (
        <div data-testid="custom-provider">{children}</div>
      ),
      AppRouter: ({ children }) => (
        <div data-testid="custom-router">{children}</div>
      ),
      dynamicRoutes: [],
      entityTabOverrides: {},
      mountPoints: {},
      menuItems: [],
      providerSettings: [],
      scaffolderFieldExtensions: [],
      techdocsAddons: [],
      translationRefs: [],
    };

    const TestComponent = () => {
      const context = React.useContext(DynamicRootContext);
      const AppProvider = context.AppProvider;
      const AppRouter = context.AppRouter;

      return (
        <div>
          <AppProvider>
            <div data-testid="app-provider-content">Provider Content</div>
          </AppProvider>
          <AppRouter>
            <div data-testid="app-router-content">Router Content</div>
          </AppRouter>
        </div>
      );
    };

    render(
      <DynamicRootContext.Provider value={customValue}>
        <TestComponent />
      </DynamicRootContext.Provider>,
    );

    expect(screen.getByTestId('custom-provider')).toBeInTheDocument();
    expect(screen.getByTestId('custom-router')).toBeInTheDocument();
    expect(screen.getByTestId('app-provider-content')).toHaveTextContent(
      'Provider Content',
    );
    expect(screen.getByTestId('app-router-content')).toHaveTextContent(
      'Router Content',
    );
  });

  it('should maintain object references for arrays and objects', () => {
    const TestComponent = () => {
      const context1 = React.useContext(DynamicRootContext);
      const context2 = React.useContext(DynamicRootContext);

      return (
        <div>
          <div data-testid="same-routes">
            {(context1.dynamicRoutes === context2.dynamicRoutes).toString()}
          </div>
          <div data-testid="same-mount-points">
            {(context1.mountPoints === context2.mountPoints).toString()}
          </div>
          <div data-testid="same-menu-items">
            {(context1.menuItems === context2.menuItems).toString()}
          </div>
        </div>
      );
    };

    render(<TestComponent />);

    // Default values should be the same references
    expect(screen.getByTestId('same-routes')).toHaveTextContent('true');
    expect(screen.getByTestId('same-mount-points')).toHaveTextContent('true');
    expect(screen.getByTestId('same-menu-items')).toHaveTextContent('true');
  });
});
