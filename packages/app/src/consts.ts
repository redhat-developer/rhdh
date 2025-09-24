export const DefaultMainMenuItems = {
  menuItems: {
    'default.home': {
      title: 'Home',
      titleKey: 'menuItem.home',
      icon: 'home',
      to: '/',
      priority: 100,
    },
    'default.my-group': {
      title: 'My Group',
      titleKey: 'menuItem.myGroup',
      icon: 'group',
      priority: 90,
    },
    'default.catalog': {
      title: 'Catalog',
      titleKey: 'menuItem.catalog',
      icon: 'category',
      to: 'catalog',
      priority: 80,
    },
    'default.apis': {
      title: 'APIs',
      titleKey: 'menuItem.apis',
      icon: 'extension',
      to: 'api-docs',
      priority: 70,
    },
    'default.learning-path': {
      title: 'Learning Paths',
      titleKey: 'menuItem.learningPaths',
      icon: 'school',
      to: 'learning-paths',
      priority: 60,
    },
    'default.create': {
      title: 'Self-service',
      titleKey: 'menuItem.selfService',
      icon: 'add',
      to: 'create',
      priority: 50,
    },
  },
};
