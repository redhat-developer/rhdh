import { ContextMenuAwareEntityLayout } from './ContextMenuAwareEntityLayout';
import { defaultTabs, tabChildren, tabRules } from './defaultTabs';
import { dynamicEntityTab, DynamicEntityTabProps } from './DynamicEntityTab';

/**
 * Displays the tabs and content for a catalog entity
 * *Note:* do not convert convert this to a component or wrap the return value
 * @param entityTabOverrides
 * @returns
 */
export const entityPage = (
  entityTabOverrides: Record<
    string,
    Omit<DynamicEntityTabProps, 'path' | 'if' | 'children'>
  > = {},
) => {
  return (
    <ContextMenuAwareEntityLayout>
      {Object.entries({ ...defaultTabs, ...entityTabOverrides }).map(
        ([path, config]) => {
          return dynamicEntityTab({
            ...config,
            path,
            ...(tabRules[path] ? tabRules[path] : {}),
            ...(tabChildren[path] ? tabChildren[path] : {}),
          } as DynamicEntityTabProps);
        },
      )}
    </ContextMenuAwareEntityLayout>
  );
};
