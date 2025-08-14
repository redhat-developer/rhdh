import { CodeSnippet, WarningPanel } from '@backstage/core-components';

export const fetcher: <T>(...args: Parameters<typeof fetch>) => Promise<T[]> = <
  T,
>(
  ...args: Parameters<typeof fetch>
) => fetch(...args).then(r => r.json()) as Promise<T[]>;

export const ErrorReport = ({
  title,
  errorText,
}: {
  title: string;
  errorText: string;
}) => (
  <WarningPanel severity="error" title={title}>
    <CodeSnippet language="text" text={errorText} />
  </WarningPanel>
);
