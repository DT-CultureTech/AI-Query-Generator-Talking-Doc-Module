export function extractSql(rawModelOutput: string): string {
  const withoutCodeFenceStart = rawModelOutput.replace(/```sql/gi, "").replace(/```/g, "");
  const withoutLabel = withoutCodeFenceStart.replace(/^\s*sql\s*[:\-]\s*/i, "").trim();

  const selectOrWithMatch = withoutLabel.match(/\b(with|select)\b[\s\S]*/i);
  const candidate = (selectOrWithMatch ? selectOrWithMatch[0] : withoutLabel).trim();

  if (candidate.length === 0) {
    return "";
  }

  const firstStatementEnd = candidate.indexOf(";");
  if (firstStatementEnd >= 0) {
    return candidate.slice(0, firstStatementEnd + 1).trim();
  }

  return `${candidate};`;
}
