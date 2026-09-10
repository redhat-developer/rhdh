import scaffolderPlugin from '@backstage/plugin-scaffolder/alpha';

/**
 * RHDH product name for the scaffolder Create page.
 *
 * Legacy (`packages/app`) sets this via scaffolder i18n
 * (`templateListPage.title`) and the sidebar item in `consts.ts`.
 * NFS renders the page heading from the PageBlueprint title (`Create`),
 * so that translation is never used. See RHDHBUGS-3676.
 */
export const RHDH_SELF_SERVICE_PAGE_TITLE = 'Self-service';

/**
 * Product override of the upstream scaffolder plugin.
 *
 * `plugin.withOverrides` + `.override({ params })` is the NFS way to change
 * a PageBlueprint title. Operators can still replace it with
 * `app.extensions.page:scaffolder.config.title`, which wins over params.
 *
 * There is no `nav-item:scaffolder` in this scaffolder build; NFS nav uses
 * the plugin title instead.
 */
export const rhdhScaffolderPlugin = scaffolderPlugin.withOverrides({
  title: RHDH_SELF_SERVICE_PAGE_TITLE,
  extensions: [
    scaffolderPlugin.getExtension('page:scaffolder').override({
      params: {
        title: RHDH_SELF_SERVICE_PAGE_TITLE,
      },
    }),
  ],
});
