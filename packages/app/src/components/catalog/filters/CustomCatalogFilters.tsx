import React from 'react';

import {
  EntityKindPicker,
  EntityLifecyclePicker,
  EntityNamespacePicker,
  EntityOwnerPicker,
  EntityProcessingStatusPicker,
  EntityTypePicker,
  UserListPicker,
} from '@backstage/plugin-catalog-react';

import { CustomEntityTagPicker } from './CustomEntityTagPicker';

/**
 * Custom filters component that provides enhanced tag filtering with OR logic
 */
export const CustomCatalogFilters = () => {
  return (
    <>
      <EntityKindPicker />
      <EntityTypePicker />
      <UserListPicker />
      <EntityOwnerPicker />
      <EntityLifecyclePicker />
      <CustomEntityTagPicker />
      <EntityProcessingStatusPicker />
      <EntityNamespacePicker />
    </>
  );
};
