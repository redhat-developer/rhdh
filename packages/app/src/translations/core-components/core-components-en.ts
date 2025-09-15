import { coreComponentsTranslationRef } from '@backstage/core-components/alpha';
import { createTranslationMessages } from '@backstage/core-plugin-api/alpha';

const en = createTranslationMessages({
  ref: coreComponentsTranslationRef,
  full: false, // False means that this is a partial translation
  messages: {
    // This is a workaround that ensures that multiple translations
    // of the shared core-components are present that was added over time.
    // See:
    // https://issues.redhat.com/browse/RHDHBUGS-1235
    // https://issues.redhat.com/browse/RHDHBUGS-1976
    //
    // For example, the 'table.header.actions' key was introduced in
    // @backstage/core-component 0.17.3 (part of Backstage 1.40.0)
    // and wasn't there in 0.17.2 (part of Backstage 1.39.0).
    //
    // See:
    // https://github.com/backstage/backstage/blob/v1.39.0/packages/core-components/src/translation.ts#L87-L107
    // https://github.com/backstage/backstage/blob/v1.40.0/packages/core-components/src/translation.ts#L87-L110
    // https://github.com/backstage/versions/blob/main/v1/releases/1.39.0/manifest.json#L80-L83
    // https://github.com/backstage/versions/blob/main/v1/releases/1.40.0/manifest.json#L80-L83
    //
    // This here is a workaround that ensures that at least these translations
    // are available also if different plugins brings their own version of @backstage/core-components.
    //
    // In the future we should make sure that translations of multiple versions of the
    // @backstage/core-components library are merged properly and are shipped with RHDH.
    // We track that change here: https://issues.redhat.com/browse/RHIDP-8836
    //
    // Added in Backstage 1.37
    'table.filter.placeholder': 'All results',
    'table.body.emptyDataSourceMessage': 'No records to display',
    'table.pagination.firstTooltip': 'First Page',
    'table.pagination.labelDisplayedRows': '{from}-{to} of {count}',
    'table.pagination.labelRowsSelect': 'rows',
    'table.pagination.lastTooltip': 'Last Page',
    'table.pagination.nextTooltip': 'Next Page',
    'table.pagination.previousTooltip': 'Previous Page',
    'table.toolbar.search': 'Filter',

    // Changed in Backstage 1.38
    'alertDisplay.message_one': '({{ count }} newer message)',
    'alertDisplay.message_other': '({{ count }} newer messages)',

    // Added in Backstage 1.40
    'table.header.actions': 'Actions',

    // Added in Backstage 1.41
    'oauthRequestDialog.message':
      'Sign-in to allow {{appTitle}} access to {{provider}} APIs and identities.',
  } as any,
});

export default en;
