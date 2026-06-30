import { type JsonObject } from "@backstage/types";

interface LogActor {
  actorId?: string;
}

export interface LogRequest {
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

interface LogResponse {
  status: number;
}

const EVENT_STATUSES = ["initiated", "succeeded", "failed"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

const EVENT_SEVERITY_LEVELS = ["low", "medium", "high", "critical"] as const;
export type EventSeverityLevel = (typeof EVENT_SEVERITY_LEVELS)[number];

const DEFAULT_ACTOR_ID = "user:development/guest";

export class Log {
  actor: LogActor;
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
    this.status = overrides.status ?? "succeeded";
    this.isAuditEvent = overrides.isAuditEvent ?? true;

    this.actor = {
      actorId: overrides.actor?.actorId ?? DEFAULT_ACTOR_ID,
    };

    this.eventId = overrides.eventId ?? "";
    this.plugin = overrides.plugin ?? "";
    this.severityLevel = overrides.severityLevel ?? "low";
    this.service = overrides.service ?? "";
    this.timestamp = overrides.timestamp ?? "";
    this.request = overrides.request;
    this.response = overrides.response;
    this.meta = overrides.meta;
    this.message = overrides.message;
    this.name = overrides.name;
    this.stack = overrides.stack;
  }
}
