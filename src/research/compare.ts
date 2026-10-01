const key = (value: string): string => value.trim().toLowerCase();

/** Values present in every list, matched trim + lower-case; the first spelling is kept; first-list order. */
export function sharedValues(lists: readonly (readonly string[])[]): string[] {
  const [first, ...rest] = lists;
  if (first === undefined) return [];
  const others = rest.map((list) => new Set(list.map(key)));
  const seen = new Set<string>();
  const shared: string[] = [];
  for (const value of first) {
    const id = key(value);
    if (seen.has(id) || !others.every((set) => set.has(id))) continue;
    seen.add(id);
    shared.push(value);
  }
  return shared;
}
