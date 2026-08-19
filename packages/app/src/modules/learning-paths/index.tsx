import {
  createFrontendModule,
  createRouteRef,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import SchoolIcon from '@mui/icons-material/School';

/**
 * RHDH Learning Paths page at `/learning-paths`.
 *
 * This module is intentionally kept local to `app` rather than upstreamed,
 * since Learning Paths is a custom RHDH feature (not upstream Backstage).
 */
const learningPathsRouteRef = createRouteRef();

const learningPathsPage = PageBlueprint.make({
  name: 'learning-paths',
  params: {
    path: '/learning-paths',
    routeRef: learningPathsRouteRef,
    title: 'Learning Paths',
    icon: <SchoolIcon />,
    loader: () =>
      import('./LearningPathsPage').then(m => <m.LearningPaths />),
  },
});

export const learningPathsModule = createFrontendModule({
  pluginId: 'app',
  extensions: [learningPathsPage],
});
