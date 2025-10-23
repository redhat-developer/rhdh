import { type JsonObject } from "@backstage/types";

class Actor {
  actorId?: string;
}

export class LogRequest {
  body?: object;
  method: string;
  params?: object;
  query?: {
    facet?: string[];
    limit?: number;
    offset?: number;
  };
  url: string;
}

class LogResponse {
  status: number;
}

export type EventStatus = "initiated" | "succeeded" | "failed";

export type EventSeverityLevel = "low" | "medium" | "high" | "critical";

export class Log {
  actor: Actor;
  eventId: string;
  isAuditEvent: boolean;
  severityLevel: EventSeverityLevel;
  plugin: string;
  request?: LogRequest;
  response?: LogResponse;
  service: string;
  status: EventStatus;
  timestamp: string;
  meta?: JsonObject;

  message?: string;
  name?: string;
  stack?: string;

  /**
   * Constructor for the Log class.
   * It sets default values for status and actorId, and allows other properties to be set or overridden.
   *
   * @param overrides Partial object to override default values in the Log class
   */
  constructor(overrides: Partial<Log> = {}) {
    // Default value for status
    this.status = overrides.status || "succeeded";
    this.isAuditEvent = overrides.isAuditEvent || true;

    // Default value for actorId, with other actor properties being optional
    this.actor = {
      actorId: overrides.actor?.actorId || "user:development/guest", // Default actorId
    };

    // Other properties without default values
    this.eventId = overrides.eventId || "";
    this.plugin = overrides.plugin || "";
    this.request = overrides.request;
    this.response = overrides.response;
    this.meta = overrides.meta;
  }
}
