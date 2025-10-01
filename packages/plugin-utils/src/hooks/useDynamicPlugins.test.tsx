import React from 'react';

import { renderHook } from '@testing-library/react';

import { DynamicRootContext } from '../context';
import { ComponentRegistry } from '../types';
import { useDynamicPluginConfig } from './useDynamicPlugin';

// Mock context value
const mockContextValue: ComponentRegistry = {
  AppProvider: ({ children }) => children as any,
  AppRouter: ({ children }) => children as any,
  dynamicRoutes: [
    {
      scope: 'test',
      module: 'TestModule',
      path: '/test',
      Component: () => null,
      config: { props: {} },
    },
  ],
  entityTabOverrides: {
    'test-tab': {
      title: 'Test Tab',
      mountPoint: 'test-mount',
      priority: 1,
    },
  },
  mountPoints: {
    'test-mount': [
      {
        Component: ({ children }) => children as any,
        config: {
          if: () => true,
        },
      },
    ],
  },
  menuItems: [
    {
      name: 'test-menu',
      title: 'Test Menu',
      to: '/test',
      priority: 1,
    },
  ],
  providerSettings: [
    {
      title: 'Test Provider',
      description: 'A test provider',
      provider: 'test',
    },
  ],
  scaffolderFieldExtensions: [
    {
      scope: 'test',
      module: 'TestField',
      importName: 'TestFieldComponent',
      Component: () => null,
    },
  ],
  techdocsAddons: [
    {
      scope: 'test',
      module: 'TestAddon',
      importName: 'TestAddonComponent',
      Component: () => null,
      config: { props: {} },
    },
  ],
  translationRefs: [],
};

// Test wrapper component
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <DynamicRootContext.Provider value={mockContextValue}>
    {children}
  </DynamicRootContext.Provider>
);

describe('useDynamicPluginConfig', () => {
  it('should return configuration from context', () => {
    const { result } = renderHook(() => useDynamicPluginConfig(), {
      wrapper: TestWrapper,
    });

    expect(result.current).toEqual(
      expect.objectContaining({
        dynamicRoutes: mockContextValue.dynamicRoutes,
        entityTabOverrides: mockContextValue.entityTabOverrides,
        mountPoints: mockContextValue.mountPoints,
        menuItems: mockContextValue.menuItems,
        providerSettings: mockContextValue.providerSettings,
        scaffolderFieldExtensions: mockContextValue.scaffolderFieldExtensions,
        techdocsAddons: mockContextValue.techdocsAddons,
      }),
    );
  });

  it('should return correct dynamic routes', () => {
    const { result } = renderHook(() => useDynamicPluginConfig(), {
      wrapper: TestWrapper,
    });

    expect(result.current.dynamicRoutes).toHaveLength(1);
    expect(result.current.dynamicRoutes[0]).toEqual({
      scope: 'test',
      module: 'TestModule',
      path: '/test',
      Component: expect.any(Function),
      config: { props: {} },
    });
  });

  it('should return correct entity tab overrides', () => {
    const { result } = renderHook(() => useDynamicPluginConfig(), {
      wrapper: TestWrapper,
    });

    expect(result.current.entityTabOverrides).toEqual({
      'test-tab': {
        title: 'Test Tab',
        mountPoint: 'test-mount',
        priority: 1,
      },
    });
  });

  it('should return correct mount points', () => {
    const { result } = renderHook(() => useDynamicPluginConfig(), {
      wrapper: TestWrapper,
    });

    expect(result.current.mountPoints).toHaveProperty('test-mount');
    expect(result.current.mountPoints['test-mount']).toHaveLength(1);
    expect(result.current.mountPoints['test-mount'][0]).toEqual({
      Component: expect.any(Function),
      config: {
        if: expect.any(Function),
      },
    });
  });

  it('should return correct menu items', () => {
    const { result } = renderHook(() => useDynamicPluginConfig(), {
      wrapper: TestWrapper,
    });

    expect(result.current.menuItems).toHaveLength(1);
    expect(result.current.menuItems[0]).toEqual({
      name: 'test-menu',
      title: 'Test Menu',
      to: '/test',
      priority: 1,
    });
  });

  it('should return correct provider settings', () => {
    const { result } = renderHook(() => useDynamicPluginConfig(), {
      wrapper: TestWrapper,
    });

    expect(result.current.providerSettings).toHaveLength(1);
    expect(result.current.providerSettings[0]).toEqual({
      title: 'Test Provider',
      description: 'A test provider',
      provider: 'test',
    });
  });

  it('should return correct scaffolder field extensions', () => {
    const { result } = renderHook(() => useDynamicPluginConfig(), {
      wrapper: TestWrapper,
    });

    expect(result.current.scaffolderFieldExtensions).toHaveLength(1);
    expect(result.current.scaffolderFieldExtensions[0]).toEqual({
      scope: 'test',
      module: 'TestField',
      importName: 'TestFieldComponent',
      Component: expect.any(Function),
    });
  });

  it('should return correct techdocs addons', () => {
    const { result } = renderHook(() => useDynamicPluginConfig(), {
      wrapper: TestWrapper,
    });

    expect(result.current.techdocsAddons).toHaveLength(1);
    expect(result.current.techdocsAddons[0]).toEqual({
      scope: 'test',
      module: 'TestAddon',
      importName: 'TestAddonComponent',
      Component: expect.any(Function),
      config: { props: {} },
    });
  });

  it('should handle empty configuration', () => {
    const emptyContextValue: ComponentRegistry = {
      AppProvider: ({ children }) => children as any,
      AppRouter: ({ children }) => children as any,
      dynamicRoutes: [],
      entityTabOverrides: {},
      mountPoints: {},
      menuItems: [],
      providerSettings: [],
      scaffolderFieldExtensions: [],
      techdocsAddons: [],
      translationRefs: [],
    };

    const EmptyWrapper: React.FC<{ children: React.ReactNode }> = ({
      children,
    }) => (
      <DynamicRootContext.Provider value={emptyContextValue}>
        {children}
      </DynamicRootContext.Provider>
    );

    const { result } = renderHook(() => useDynamicPluginConfig(), {
      wrapper: EmptyWrapper,
    });

    expect(result.current.dynamicRoutes).toEqual([]);
    expect(result.current.entityTabOverrides).toEqual({});
    expect(result.current.mountPoints).toEqual({});
    expect(result.current.menuItems).toEqual([]);
    expect(result.current.providerSettings).toEqual([]);
    expect(result.current.scaffolderFieldExtensions).toEqual([]);
    expect(result.current.techdocsAddons).toEqual([]);
  });

  it('should update when context value changes', () => {
    let contextValue = mockContextValue;

    const DynamicWrapper: React.FC<{ children: React.ReactNode }> = ({
      children,
    }) => (
      <DynamicRootContext.Provider value={contextValue}>
        {children}
      </DynamicRootContext.Provider>
    );

    const { result, rerender } = renderHook(() => useDynamicPluginConfig(), {
      wrapper: DynamicWrapper,
    });

    expect(result.current.menuItems).toHaveLength(1);

    // Update context value
    contextValue = {
      ...mockContextValue,
      menuItems: [
        ...mockContextValue.menuItems,
        {
          name: 'new-menu',
          title: 'New Menu',
          to: '/new',
        },
      ],
    };

    rerender();

    expect(result.current.menuItems).toHaveLength(2);
    expect(result.current.menuItems[1]).toEqual({
      name: 'new-menu',
      title: 'New Menu',
      to: '/new',
    });
  });

  it('should throw error when context is null', () => {
    // Explicitly provide null as the context value
    const NullWrapper: React.FC<{ children: React.ReactNode }> = ({
      children,
    }) => (
      <DynamicRootContext.Provider value={null as any}>
        {children}
      </DynamicRootContext.Provider>
    );

    expect(() => {
      renderHook(() => useDynamicPluginConfig(), {
        wrapper: NullWrapper,
      });
    }).toThrow('useDynamicPlugin must be used within a DynamicPluginProvider');
  });
});
