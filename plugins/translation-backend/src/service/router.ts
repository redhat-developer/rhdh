import { LoggerService } from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';

import express, { Router } from 'express';

import fs from 'fs';
import path from 'path';

import {
  deepMergeTranslations,
  filterLocales,
  isValidJSONTranslation,
} from '../utils';

export async function createRouter({
  config,
  logger,
}: {
  config: Config;
  logger: LoggerService;
}): Promise<Router> {
  let cachedTranslations: Record<string, any> | null = null;

  const overridesFiles = config.getOptionalStringArray('i18n.overrides') ?? [];
  const configuredLocales = config.getOptionalStringArray('i18n.locales') ?? [
    'en',
  ];

  const router = Router();
  router.use(express.json());
  router.get('/', (_, res) => {
    try {
      if (!cachedTranslations) {
        const mergedTranslations: Record<string, any> = {};

        for (const overridesFile of overridesFiles) {
          const resolvedPath = path.resolve(overridesFile);
          if (!fs.existsSync(resolvedPath)) {
            logger.warn(`File not found: ${overridesFile}`);
            continue;
          }

          const raw = fs.readFileSync(resolvedPath, 'utf-8');
          const json = JSON.parse(raw);
          if (!isValidJSONTranslation(json)) {
            logger.warn(`Invalid JSON translation file: ${overridesFile}`);
            continue;
          }

          deepMergeTranslations(mergedTranslations, json);
        }

        if (Object.keys(mergedTranslations).length === 0) {
          res.status(404).json({
            error: 'No valid translation overrides found in the provided files',
          });
          return;
        }

        cachedTranslations = filterLocales(
          mergedTranslations,
          configuredLocales,
        );
      }

      if (!cachedTranslations || Object.keys(cachedTranslations).length === 0) {
        res.status(200).json({});
        return;
      }

      res.json(cachedTranslations);
    } catch (e) {
      logger.warn(`Failed to process translation override files: ${e}`);
      res
        .status(500)
        .json({ error: 'Failed to process translation override files' });
    }
  });

  return router;
}
