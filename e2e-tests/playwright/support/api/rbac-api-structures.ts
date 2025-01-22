export interface Policy {
  entityReference?: string;
  permission: string;
  policy: string;
  effect: string;
}

export interface Role {
  memberReferences: string[];
  name: string;
}
