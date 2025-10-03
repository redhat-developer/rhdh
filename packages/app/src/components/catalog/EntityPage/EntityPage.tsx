import { useTranslation } from '../../../hooks/useTranslation';
import { ContextMenuAwareEntityLayout } from './ContextMenuAwareEntityLayout';
import { tabChildren, tabRules } from './defaultTabs';
import { dynamicEntityTab, DynamicEntityTabProps } from './DynamicEntityTab';
import { mergeTabs } from './utils';

const EntityPageWithTranslation = ({
  entityTabOverrides,
}: {
  entityTabOverrides: Record<
    string,
    Omit<DynamicEntityTabProps, 'path' | 'if' | 'children'>
  >;
}) => {
  const { t } = useTranslation();

  const getTranslatedTitle = (title: string, titleKey?: string) => {
    if (!titleKey) {
      return title;
    }
    const translatedTitle = t(titleKey as any, {});
    if (translatedTitle !== titleKey) {
      return translatedTitle;
    }
    return title;
  };

  return (
    <ContextMenuAwareEntityLayout>
      {mergeTabs(entityTabOverrides).map(([path, config]) => {
        return dynamicEntityTab({
          ...config,
          title: getTranslatedTitle(config.title, config.titleKey),
          path,
          ...(tabRules[path] ? tabRules[path] : {}),
          ...(tabChildren[path] ? tabChildren[path] : {}),
        } as DynamicEntityTabProps);
      })}
    </ContextMenuAwareEntityLayout>
  );
};

/**
 * Displays the tabs and content for a catalog entity
 * @param entityTabOverrides
 * @returns
 */
export const entityPage = (
  entityTabOverrides: Record<
    string,
    Omit<DynamicEntityTabProps, 'path' | 'if' | 'children'>
  > = {},
) => {
  return <EntityPageWithTranslation entityTabOverrides={entityTabOverrides} />;
};
