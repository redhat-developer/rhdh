import { defaultTabs } from './defaultTabs';
import { DynamicEntityTabProps } from './DynamicEntityTab';

export const mergeTabs = (
  entityTabOverrides: Record<
    string,
    Omit<DynamicEntityTabProps, 'path' | 'if' | 'children'>
  >,
) => {
  return (
    Object.entries({ ...defaultTabs, ...entityTabOverrides })
      .filter(([, tab]) => !(tab.priority && tab.priority < 0))
      .sort(([, tabA], [, tabB]) => {
        const priorityA = tabA.priority ?? 0;
        const priorityB = tabB.priority ?? 0;
        return priorityB - priorityA;
      }) || []
  );
};
