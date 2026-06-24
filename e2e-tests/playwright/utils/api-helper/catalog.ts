import { request } from "@playwright/test";

import {
  type CatalogLocationEntry,
  isCatalogLocationEntry,
  isEntityMetadataResponse,
  parseJsonResponse,
} from "./guards";

export async function getEntityUidByName(name: string): Promise<string | undefined> {
  const baseUrl = process.env.BASE_URL;
  const url = `${baseUrl}/api/catalog/entities/by-name/template/default/${name}`;
  const context = await request.newContext();
  const response = await context.get(url);
  if (response.status() !== 200) {
    return undefined;
  }
  const data: unknown = await parseJsonResponse(response);
  if (!isEntityMetadataResponse(data)) {
    return undefined;
  }
  return data.metadata?.uid;
}

export async function deleteLocationByUid(uid: string): Promise<number> {
  const baseUrl = process.env.BASE_URL;
  const url = `${baseUrl}/api/catalog/locations/${uid}`;
  const context = await request.newContext();
  const response = await context.delete(url);
  return response.status();
}

export async function getTemplateEntityUidByName(
  name: string,
  namespace: string = "default",
): Promise<string | undefined> {
  const baseUrl = process.env.BASE_URL;
  const url = `${baseUrl}/api/catalog/locations/by-entity/template/${namespace}/${name}`;
  const context = await request.newContext();
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
  const baseUrl = process.env.BASE_URL;
  const url = `${baseUrl}/api/catalog/locations/${id}`;
  const context = await request.newContext();
  const response = await context.delete(url);
  return response.status();
}

export async function registerLocation(target: string): Promise<number> {
  const baseUrl = process.env.BASE_URL;
  const url = `${baseUrl}/api/catalog/locations`;
  const context = await request.newContext();
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
  const baseUrl = process.env.BASE_URL;
  const url = `${baseUrl}/api/catalog/locations`;
  const context = await request.newContext();
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
