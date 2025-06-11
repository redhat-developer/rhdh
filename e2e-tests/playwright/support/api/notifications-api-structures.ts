export interface Payload {
  title: string;
  description: string;
  severity: string;
  topic: string;
}

export interface Recipients {
  type: string;
  entityRef: string[];
}

export interface Notifications {
  recipients: Recipients;
  payload: Payload;
}
