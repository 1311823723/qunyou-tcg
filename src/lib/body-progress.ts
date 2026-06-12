export type BodyWithExtraFormCondition = {
  extraForm?: {
    condition?: string;
  };
};

export function getExtraFormProgressMax(body: BodyWithExtraFormCondition): number | undefined {
  const condition = body.extraForm?.condition;
  if (!condition) return undefined;
  const match = condition.match(/累计[^\d]{0,24}(\d+)\s*(?:点|次|张)/);
  return match ? Number(match[1]) : undefined;
}
