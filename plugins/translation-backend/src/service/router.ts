import { LoggerService } from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';

import express, { Router } from 'express';

import fs from 'fs';
import path from 'path';

import { deepMergeTranslations, isValidJSONTranslation } from '../utils';

export async function createRouter({
  config,
  logger,
}: {
  config: Config;
  logger: LoggerService;
}): Promise<Router> {
  const overridesFiles = config.getOptionalStringArray('i18n.overrides') ?? [];
  const router = Router();
  router.use(express.json());
  router.get('/', (_, res) => {
    if (!overridesFiles || overridesFiles?.length === 0) {
      res.status(200).json({});
      return;
    }
    try {
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
          error: 'No valid translation overrides found in provided files',
        });
        return;
      }

      res.json(mergedTranslations);
    } catch (e) {
      logger.warn(`Failed to process translation override files: ${e}`);
      res
        .status(500)
        .json({ error: 'Failed to process translation override files' });
    }
  });

  return router;
}
