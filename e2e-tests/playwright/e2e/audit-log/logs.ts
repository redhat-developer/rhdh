/**
 * Interface definition for Backstage audit logs
 * Represents the structured format of a log event
 */
export interface Log {
  timestamp?: string;
  plugin?: string;
  message?: string;
  eventId?: string;
  severityLevel?: string;
  actor?: {
    actorId?: string;
    ip?: string;
    hostname?: string;
    userAgent?: string;
  };
  request?: {
    url?: string;
    method?: string;
  };
  meta?: {
    queryType?: string;
    entityRef?: string;
  };
  status?: string;
  trace_id?: string;
  span_id?: string;
  trace_flags?: string;
  isAuditEvent?: boolean;
}
