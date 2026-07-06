import { type APIRequestContext, request } from "@playwright/test";

import {
  type CatalogLocationEntry,
  isCatalogLocationEntry,
  isEntityMetadataResponse,
  parseJsonResponse,
} from "./guards";

async function createCatalogApiRequest(): Promise<{
  context: APIRequestContext;
  baseUrl: string;
}> {
  return {
    context: await request.newContext(),
    baseUrl: process.env.BASE_URL ?? "",
  };
}

export async function getTemplateEntityUidByName(
  name: string,
  namespace: string = "default",
): Promise<string | undefined> {
  const { context, baseUrl } = await createCatalogApiRequest();
  const url = `${baseUrl}/api/catalog/locations/by-entity/template/${namespace}/${name}`;
  const response = await context.get(url);
  if (response.status() === 200) {
    const data: unknown = await parseJsonResponse(response);
    if (!isEntityMetadataResponse(data)) {
      return undefined;
    }
    return data.metadata?.uid;
  }
  if (response.status() === 404) {
    return undefined;
  }
  return undefined;
}

export async function deleteEntityLocationById(id: string): Promise<number> {
  const { context, baseUrl } = await createCatalogApiRequest();
  const url = `${baseUrl}/api/catalog/locations/${id}`;
  const response = await context.delete(url);
  return response.status();
}

export async function registerLocation(target: string): Promise<number> {
  const { context, baseUrl } = await createCatalogApiRequest();
  const url = `${baseUrl}/api/catalog/locations`;
  const response = await context.post(url, {
    data: {
      type: "url",
      target,
    },
    headers: {
      "Content-Type": "application/json",
    },
  });
  return response.status();
}

export async function getLocationIdByTarget(target: string): Promise<string | undefined> {
  const { context, baseUrl } = await createCatalogApiRequest();
  const url = `${baseUrl}/api/catalog/locations`;
  const response = await context.get(url);
  if (response.status() !== 200) {
    return undefined;
  }
  const data: unknown = await parseJsonResponse(response);
  if (!Array.isArray(data)) {
    return undefined;
  }
  const location = data.find(
    (entry): entry is CatalogLocationEntry =>
      isCatalogLocationEntry(entry) && entry.data?.target === target,
  );
  return location?.data?.id;
}
