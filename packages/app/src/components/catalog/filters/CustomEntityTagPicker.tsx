import React from 'react';

import { Entity } from '@backstage/catalog-model';
import { useTranslationRef } from '@backstage/core-plugin-api/alpha';
import { EntityAutocompletePicker } from '@backstage/plugin-catalog-react';
import { catalogReactTranslationRef } from '@backstage/plugin-catalog-react/alpha';

// Custom EntityTagFilter with OR logic instead of AND logic
export class CustomEntityTagFilter {
  readonly values: string[];

  constructor(values: string[]) {
    this.values = values;
  }

  filterEntity(entity: Entity): boolean {
    if (!this.values.length) {
      return true;
    }

    const tags = entity.metadata?.tags || [];
    if (!tags.length) {
      return false;
    }

    // OR logic: return true if entity has ANY of the selected tags
    return this.values.some(value => tags.includes(value));
  }

  toQueryValue(): string[] {
    return this.values;
  }

  getCatalogFilters(): Record<string, string | string[]> {
    return {
      'metadata.tags': this.values,
    };
  }
}

interface CustomEntityTagPickerProps {
  showCounts?: boolean;
  initialFilter?: string[];
}

/**
 * Custom Entity Tag Picker with OR logic for multiple tag selections
 * Uses the same EntityAutocompletePicker as the original but with custom filter logic
 */
const CustomEntityTagPicker: React.FC<CustomEntityTagPickerProps> = ({
  showCounts = false,
  initialFilter = [],
}) => {
  const { t } = useTranslationRef(catalogReactTranslationRef);

  return (
    <EntityAutocompletePicker
      label={t('entityTagPicker.title')}
      name="tags"
      path="metadata.tags"
      Filter={CustomEntityTagFilter}
      showCounts={showCounts}
      initialSelectedOptions={initialFilter}
    />
  );
};

export { CustomEntityTagPicker };
