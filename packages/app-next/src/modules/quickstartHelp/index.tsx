import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { useAppDrawer } from '@red-hat-developer-hub/backstage-plugin-app-react/alpha';
import {
  GlobalHeaderMenuItem,
  GlobalHeaderMenuItemBlueprint,
} from '@red-hat-developer-hub/backstage-plugin-global-header/alpha';

const QUICKSTART_DRAWER_ID = 'quickstart';

const QuickstartHelpMenuItem = ({
  handleClose,
}: {
  handleClose?: () => void;
}) => {
  const { toggleDrawer } = useAppDrawer();

  return (
    <GlobalHeaderMenuItem
      title="Quick start"
      icon="waving_hand"
      onClick={() => {
        toggleDrawer(QUICKSTART_DRAWER_ID);
        handleClose?.();
      }}
    />
  );
};

const quickstartHelpMenuItem = GlobalHeaderMenuItemBlueprint.make({
  name: 'quickstart-help',
  params: {
    target: 'help',
    component: QuickstartHelpMenuItem,
    priority: 50,
  },
});

export const quickstartHelpModule = createFrontendModule({
  pluginId: 'app',
  extensions: [quickstartHelpMenuItem],
});
