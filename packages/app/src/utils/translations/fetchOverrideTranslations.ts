export const fetchOverrideTranslations = async (
  baseUrl: string,
): Promise<Record<string, Record<string, Record<string, string>>>> => {
  try {
    const res = await fetch(`${baseUrl}/api/translations`);
    if (!res.ok) {
      let errorMessage = `/api/translation Request failed with status ${res.status}`;
      const errorBody = await res.json();
      if (errorBody?.error) {
        errorMessage += `: ${errorBody.error}`;
      }

      // eslint-disable-next-line no-console
      console.warn(errorMessage);
      return {};
    }
    return res.json();
  } catch (err) {
    return {};
  }
};
