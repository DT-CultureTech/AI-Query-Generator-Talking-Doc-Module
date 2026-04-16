export function buildModelCandidates(primaryModel: string, fallbackModels: string[]): string[] {
  const ordered = [primaryModel, ...fallbackModels];
  const unique = new Set<string>();

  for (const model of ordered) {
    const trimmed = model.trim();
    if (trimmed.length > 0) {
      unique.add(trimmed);
    }
  }

  return Array.from(unique);
}
