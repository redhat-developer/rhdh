import { Entity } from '@backstage/catalog-model';

import extractDynamicConfig, {
  conditionsArrayMapper,
  configIfToCallable,
  DynamicPluginConfig,
} from './extractDynamicConfig';

describe('conditionsArrayMapper', () => {
  it.each([
    ['always true', true, () => true],
    ['always false', false, () => false],
    ['function call', true, ({ kind }: Entity) => kind.startsWith('A')],
    ['function call', false, ({ kind }: Entity) => kind.startsWith('B')],
    ['isKind', true, { isKind: 'API' }],
    ['isKind multiple', true, { isKind: ['API', 'Component'] }],
    ['isKind', false, { isKind: 'Component' }],
    ['isKind multiple', false, { isKind: ['Component', 'System'] }],
    ['isType', true, { isType: 'foo' }],
    ['isType multiple', true, { isType: ['foo', 'xyz'] }],
    ['isType', false, { isType: 'xyz' }],
    ['isType multiple', false, { isType: ['xyz', 'abc'] }],
    ['hasAnnotation', true, { hasAnnotation: 'baz' }],
    ['hasAnnotation', false, { hasAnnotation: 'xyz' }],
  ])('%s resolves to %s', (_, result, condition) => {
    const entity: Entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'API',
      spec: {
        type: 'foo',
      },
      metadata: {
        name: 'bar',
        annotations: {
          baz: 'baz',
        },
      },
    };
    expect(conditionsArrayMapper(condition)(entity)).toBe(result);
  });
});

describe('configIfToCallable', () => {
  it('is truthy for no condition', () => {
    const func = configIfToCallable({});
    expect(func({} as Entity)).toBeTruthy();
  });
  it('is falsy for oneOf with multiple same conditions', () => {
    const func = configIfToCallable({
      oneOf: [
        ({ kind }: Entity) => kind === 'API',
        ({ kind }: Entity) => kind === 'API',
      ],
    });
    expect(func({ kind: 'API' } as Entity)).toBeFalsy();
  });

  it.each([
    [
      'allOf with single condition',
      { allOf: [({ kind }: Entity) => kind === 'API'] },
      { kind: 'API' },
      { kind: 'Component' },
    ],
    [
      'allOf with multiple same conditions',
      {
        allOf: [
          ({ kind }: Entity) => kind === 'API',
          ({ kind }: Entity) => kind === 'API',
        ],
      },
      { kind: 'API' },
      { kind: 'Component' },
    ],
    [
      'allOf with multiple different conditions',
      {
        allOf: [
          ({ kind }: Entity) => kind === 'API',
          ({ apiVersion }: Entity) => apiVersion === 'backstage.io/v1alpha1',
        ],
      },
      { kind: 'API', apiVersion: 'backstage.io/v1alpha1' },
      { kind: 'Component', apiVersion: 'backstage.io/v1alpha1' },
    ],
    [
      'anyOf with single condition',
      { anyOf: [({ kind }: Entity) => kind === 'API'] },
      { kind: 'API' },
      { kind: 'Component' },
    ],
    [
      'anyOf with multiple same conditions',
      {
        anyOf: [
          ({ kind }: Entity) => kind === 'API',
          ({ kind }: Entity) => kind === 'API',
        ],
      },
      { kind: 'API' },
      { kind: 'Component' },
    ],
    [
      'anyOf with multiple different conditions',
      {
        anyOf: [
          ({ kind }: Entity) => kind === 'API',
          ({ apiVersion }: Entity) => apiVersion === 'backstage.io/v1beta1',
        ],
      },
      { kind: 'API', apiVersion: 'backstage.io/v1alpha1' },
      { kind: 'Component', apiVersion: 'backstage.io/v1alpha1' },
    ],
    [
      'oneOf with single condition',
      { oneOf: [({ kind }: Entity) => kind === 'API'] },
      { kind: 'API' },
      { kind: 'Component' },
    ],
    [
      'oneOf with multiple different conditions',
      {
        oneOf: [
          ({ kind }: Entity) => kind === 'API',
          ({ apiVersion }: Entity) => apiVersion === 'backstage.io/v1alpha1',
        ],
      },
      { kind: 'Component', apiVersion: 'backstage.io/v1alpha1' },
      { kind: 'Component', apiVersion: 'backstage.io/v1beta1' },
    ],
  ])('%s', (_, source, entityOk, entityNotOk) => {
    const func = configIfToCallable(source);
    expect(func(entityOk as Entity)).toBeTruthy();
    expect(func(entityNotOk as Entity)).toBeFalsy();
  });
});

describe('extractDynamicConfig', () => {
  it.each([
    ['config is empty', {}],
    ['no dynamic plugins are defined', { dynamicPlugins: {} }],
    [
      'no frontend dynamic plugins are defined',
      { dynamicPlugins: { frontend: {} } },
    ],
  ])('returns empty data when %s', (_, source) => {
    const config = extractDynamicConfig(source as DynamicPluginConfig);
    expect(config).toEqual({
      pluginModules: [],
      routeBindings: [],
      dynamicRoutes: [],
      entityTabs: [],
      menuItems: [],
      mountPoints: [],
      appIcons: [],
      providerSettings: [],
      routeBindingTargets: [],
      apiFactories: [],
      analyticsApiExtensions: [],
      scaffolderFieldExtensions: [],
      signInPages: [],
      techdocsAddons: [],
      themes: [],
      translationResources: [],
    });
  });

  it.each([
    [
      'a SignInPage',
      { signInPage: { importName: 'blah' } },
      {
        signInPages: [
          {
            importName: 'blah',
            module: 'PluginRoot',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'a dynamicRoute',
      { dynamicRoutes: [{ path: '/foo' }] },
      {
        dynamicRoutes: [
          {
            importName: 'default',
            module: 'PluginRoot',
            path: '/foo',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'multiple dynamicRoutes',
      { dynamicRoutes: [{ path: '/foo' }, { path: '/bar' }] },
      {
        dynamicRoutes: [
          {
            importName: 'default',
            module: 'PluginRoot',
            path: '/foo',
            scope: 'janus-idp.plugin-foo',
          },
          {
            importName: 'default',
            module: 'PluginRoot',
            path: '/bar',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'a dynamicRoute with module',
      { dynamicRoutes: [{ path: '/foo', module: 'FooRoot' }] },
      {
        dynamicRoutes: [
          {
            importName: 'default',
            module: 'FooRoot',
            path: '/foo',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'a dynamicRoute with importName',
      { dynamicRoutes: [{ path: '/foo', importName: 'FooPage' }] },
      {
        dynamicRoutes: [
          {
            importName: 'FooPage',
            module: 'PluginRoot',
            path: '/foo',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'a dynamicRoute with menuItem',
      {
        dynamicRoutes: [
          { path: '/foo', menuItem: { icon: 'foo', text: 'Foo' } },
        ],
      },
      {
        dynamicRoutes: [
          {
            importName: 'default',
            module: 'PluginRoot',
            path: '/foo',
            scope: 'janus-idp.plugin-foo',
            menuItem: { icon: 'foo', text: 'Foo' },
          },
        ],
        menuItems: [
          {
            children: [],
            icon: 'foo',
            name: 'foo',
            title: 'Foo',
            to: '/foo',
            enabled: true,
          },
        ],
      },
    ],
    [
      'a mountPoint',
      {
        mountPoints: [{ mountPoint: 'entity.page.foo/cards' }],
      },
      {
        mountPoints: [
          {
            importName: 'default',
            module: 'PluginRoot',
            mountPoint: 'entity.page.foo/cards',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'multiple mountPoints',
      {
        mountPoints: [
          { mountPoint: 'entity.page.foo/cards' },
          { mountPoint: 'entity.page.foo/context' },
        ],
      },
      {
        mountPoints: [
          {
            importName: 'default',
            module: 'PluginRoot',
            mountPoint: 'entity.page.foo/cards',
            scope: 'janus-idp.plugin-foo',
          },
          {
            importName: 'default',
            module: 'PluginRoot',
            mountPoint: 'entity.page.foo/context',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'a mountPoint with importName',
      {
        mountPoints: [
          { mountPoint: 'entity.page.foo/cards', importName: 'FooCard' },
        ],
      },
      {
        mountPoints: [
          {
            importName: 'FooCard',
            module: 'PluginRoot',
            mountPoint: 'entity.page.foo/cards',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'a mountPoint with module',
      {
        mountPoints: [
          { mountPoint: 'entity.page.foo/cards', module: 'FooRoot' },
        ],
      },
      {
        mountPoints: [
          {
            importName: 'default',
            module: 'FooRoot',
            mountPoint: 'entity.page.foo/cards',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'a mountPoint with empty config',
      {
        mountPoints: [{ mountPoint: 'entity.page.foo/cards', config: {} }],
      },
      {
        mountPoints: [
          {
            importName: 'default',
            module: 'PluginRoot',
            mountPoint: 'entity.page.foo/cards',
            scope: 'janus-idp.plugin-foo',
            config: {},
          },
        ],
      },
    ],
    [
      'a mountPoint with config layout',
      {
        mountPoints: [
          {
            mountPoint: 'entity.page.foo/cards',
            config: { layout: { gridColumnStart: 1 } },
          },
        ],
      },
      {
        mountPoints: [
          {
            importName: 'default',
            module: 'PluginRoot',
            mountPoint: 'entity.page.foo/cards',
            scope: 'janus-idp.plugin-foo',
            config: {
              layout: {
                gridColumnStart: 1,
              },
            },
          },
        ],
      },
    ],
    [
      'an appIcon',
      {
        appIcons: [{ name: 'foo' }],
      },
      {
        appIcons: [
          {
            importName: 'default',
            module: 'PluginRoot',
            name: 'foo',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'multiple appIcons',
      {
        appIcons: [{ name: 'foo' }, { name: 'bar' }],
      },
      {
        appIcons: [
          {
            importName: 'default',
            module: 'PluginRoot',
            name: 'foo',
            scope: 'janus-idp.plugin-foo',
          },
          {
            importName: 'default',
            module: 'PluginRoot',
            name: 'bar',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'an appIcon with importName',
      {
        appIcons: [{ name: 'foo', importName: 'FooIcon' }],
      },
      {
        appIcons: [
          {
            importName: 'FooIcon',
            module: 'PluginRoot',
            name: 'foo',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'an appIcon with module',
      {
        appIcons: [{ name: 'foo', module: 'FooRoot' }],
      },
      {
        appIcons: [
          {
            importName: 'default',
            module: 'FooRoot',
            name: 'foo',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'an analytics api extension',
      {
        analyticsApiExtensions: [{ importName: 'foo', module: 'FooRoot' }],
      },
      {
        analyticsApiExtensions: [
          {
            importName: 'foo',
            module: 'FooRoot',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'an analytics api extension; default module',
      {
        analyticsApiExtensions: [{ importName: 'foo' }],
      },
      {
        analyticsApiExtensions: [
          {
            importName: 'foo',
            module: 'PluginRoot',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'an analytics api extension; default importName',
      {
        analyticsApiExtensions: [{ module: 'FooRoot' }],
      },
      {
        analyticsApiExtensions: [
          {
            importName: 'default',
            module: 'FooRoot',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'multiple analytics api extensions',
      {
        analyticsApiExtensions: [
          { importName: 'foo', module: 'FooRoot' },
          { importName: 'bar', module: 'BarRoot' },
        ],
      },
      {
        analyticsApiExtensions: [
          {
            importName: 'foo',
            module: 'FooRoot',
            scope: 'janus-idp.plugin-foo',
          },
          {
            importName: 'bar',
            module: 'BarRoot',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'empty analytics api extensions array',
      {
        analyticsApiExtensions: [],
      },
      {
        analyticsApiExtensions: [],
      },
    ],
    [
      'a scaffolder field extension',
      {
        scaffolderFieldExtensions: [{ importName: 'foo', module: 'FooRoot' }],
      },
      {
        scaffolderFieldExtensions: [
          {
            importName: 'foo',
            module: 'FooRoot',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'a scaffolder field extension; default module',
      {
        scaffolderFieldExtensions: [{ importName: 'foo' }],
      },
      {
        scaffolderFieldExtensions: [
          {
            importName: 'foo',
            module: 'PluginRoot',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'multiple scaffolder field extensions',
      {
        scaffolderFieldExtensions: [
          { importName: 'foo', module: 'FooRoot' },
          { importName: 'bar', module: 'BarRoot' },
        ],
      },
      {
        scaffolderFieldExtensions: [
          {
            importName: 'foo',
            module: 'FooRoot',
            scope: 'janus-idp.plugin-foo',
          },
          {
            importName: 'bar',
            module: 'BarRoot',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'a providerSettings',
      {
        providerSettings: [
          {
            title: 'foo',
            description: 'bar',
            provider: 'foo.bar',
          },
        ],
      },
      {
        providerSettings: [
          {
            title: 'foo',
            description: 'bar',
            provider: 'foo.bar',
          },
        ],
      },
    ],
    [
      'multiple providerSettings',
      {
        providerSettings: [
          {
            title: 'foo1',
            description: 'bar1',
            provider: 'foo.bar1',
          },
          {
            title: 'foo2',
            description: 'bar2',
            provider: 'foo.bar2',
          },
        ],
      },
      {
        providerSettings: [
          {
            title: 'foo1',
            description: 'bar1',
            provider: 'foo.bar1',
          },
          {
            title: 'foo2',
            description: 'bar2',
            provider: 'foo.bar2',
          },
        ],
      },
    ],
    [
      'a techdocs field extension',
      {
        techdocsAddons: [{ importName: 'foo', module: 'FooRoot' }],
      },
      {
        techdocsAddons: [
          {
            importName: 'foo',
            module: 'FooRoot',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'a techdocs field extension; default module',
      {
        techdocsAddons: [{ importName: 'foo' }],
      },
      {
        techdocsAddons: [
          {
            importName: 'foo',
            module: 'PluginRoot',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
    [
      'multiple techdocs field extensions',
      {
        techdocsAddons: [
          { importName: 'foo', module: 'FooRoot' },
          { importName: 'bar', module: 'BarRoot' },
        ],
      },
      {
        techdocsAddons: [
          {
            importName: 'foo',
            module: 'FooRoot',
            scope: 'janus-idp.plugin-foo',
          },
          {
            importName: 'bar',
            module: 'BarRoot',
            scope: 'janus-idp.plugin-foo',
          },
        ],
      },
    ],
  ])('parses %s', (_, source: any, output) => {
    const config = extractDynamicConfig({
      frontend: { 'janus-idp.plugin-foo': source },
    });
    expect(config).toEqual({
      pluginModules: [
        {
          module: 'PluginRoot',
          scope: 'janus-idp.plugin-foo',
        },
      ],
      routeBindings: [],
      routeBindingTargets: [],
      dynamicRoutes: [],
      entityTabs: [],
      menuItems: [],
      mountPoints: [],
      appIcons: [],
      apiFactories: [],
      analyticsApiExtensions: [],
      scaffolderFieldExtensions: [],
      signInPages: [],
      techdocsAddons: [],
      themes: [],
      providerSettings: [],
      translationResources: [],
      ...output,
    });
  });
});
