function evidenceKey(match) {
  return `${match.repository_id}:${match.file_path}:${match.chunk_index}`;
}

export function reciprocalRankFusion(resultSets, terms, { rankConstant = 60 } = {}) {
  const merged = new Map();
  for (const [source, matches] of Object.entries(resultSets)) {
    matches.forEach((match, index) => {
      const key = evidenceKey(match);
      const current = merged.get(key) || { raw: match, sources: new Set(), score: 0, termCoverage: 0, ranks: {} };
      current.sources.add(source);
      current.score += 1 / (rankConstant + index + 1);
      current.ranks[source] = index + 1;
      const normalized = String(match.content || "").toLocaleLowerCase("pt-BR");
      current.termCoverage = Math.max(current.termCoverage, terms.filter((term) => normalized.includes(term.toLocaleLowerCase("pt-BR"))).length);
      if (!current.raw.content || String(match.content || "").length > String(current.raw.content || "").length) current.raw = match;
      merged.set(key, current);
    });
  }
  return [...merged.values()].sort((a, b) =>
    (b.sources.size - a.sources.size)
    || (b.termCoverage - a.termCoverage)
    || (b.score - a.score)
    || evidenceKey(a.raw).localeCompare(evidenceKey(b.raw))
  );
}

export function diversifyEvidence(candidates, limit, perFile = 2) {
  const selected = [];
  const repositoryCounts = new Map();
  const fileCounts = new Map();
  const deferred = [];
  for (const candidate of candidates) {
    const repo = String(candidate.raw.repository_id);
    const file = `${repo}:${candidate.raw.file_path}`;
    const repositoryQuota = selected.length < Math.min(4, limit) ? 1 : Number.POSITIVE_INFINITY;
    if ((repositoryCounts.get(repo) || 0) >= repositoryQuota || (fileCounts.get(file) || 0) >= perFile) {
      deferred.push(candidate);
      continue;
    }
    selected.push(candidate);
    repositoryCounts.set(repo, (repositoryCounts.get(repo) || 0) + 1);
    fileCounts.set(file, (fileCounts.get(file) || 0) + 1);
    if (selected.length === limit) return selected;
  }
  for (const candidate of deferred) {
    const file = `${candidate.raw.repository_id}:${candidate.raw.file_path}`;
    if ((fileCounts.get(file) || 0) >= perFile) continue;
    selected.push(candidate);
    fileCounts.set(file, (fileCounts.get(file) || 0) + 1);
    if (selected.length === limit) break;
  }
  return selected;
}
