function getTechdocsExensions<T = any, T2 = any>({
  api = { dynamicRootConfig: { techdocExtensions: {} } },
}: {
  api: any;
}): { config: any; Component: T; staticJSXContent: T2 }[] {
  const techdocComponents =
    api.dynamicRootConfig?.techdocsFieldExtensions ?? [];
  return techdocComponents;
}
