export type BuildInfo = {
  title?: string;
  titleKey?: string;
  card: { [key: string]: string };
  full?: boolean;
  overrideBuildInfo?: boolean;
};
