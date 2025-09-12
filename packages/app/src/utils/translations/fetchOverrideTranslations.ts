export const fetchOverrideTranslations = async (
  baseUrl: string,
): Promise<Record<string, Record<string, Record<string, string>>>> => {
  try {
    const res = await fetch(`${baseUrl}/api/translation`);
    if (!res.ok) {
      return {};
    }
    return res.json();
  } catch (err) {
    return {};
  }
};
