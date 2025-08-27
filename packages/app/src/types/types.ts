export type LearningPathLink = {
  label: string;
  url: string;
  description?: string;
  hours?: number;
  minutes?: number;
  paths?: number;
};

export type BuildInfo = {
  title: string;
  card: { [key: string]: string };
  full?: boolean;
};
