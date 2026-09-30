// What plays after `afterId`: the next song that is not known to be unplayable.
// With shuffle, the pick is made ahead of time and kept for the same song, so the
// next song can be prepared and blended like any other. `pick` is the previous
// { from, id } choice; the result returns the (possibly new) pick to store.
export function nextPlayable(queue, afterId, { shuffle = false, wrap = false, unplayable = new Set(), pick = null, random = Math.random } = {}) {
  const playable = item => item && item.id !== afterId && !unplayable.has(item.id);
  if (!queue?.length) return { item: null, pick };
  if (shuffle) {
    const kept = pick?.from === afterId ? queue.find(item => item.id === pick.id) : null;
    if (playable(kept)) return { item: kept, pick };
    const options = queue.filter(playable);
    if (!options.length) return { item: null, pick: null };
    const item = options[Math.min(options.length - 1, Math.floor(random() * options.length))];
    return { item, pick: { from: afterId, id: item.id } };
  }
  const index = queue.findIndex(item => item.id === afterId);
  for (let step = 1; step <= queue.length; step++) {
    let position = index + step;
    if (position >= queue.length) {
      if (!wrap) break;
      position -= queue.length;
    }
    if (playable(queue[position])) return { item: queue[position], pick };
  }
  return { item: null, pick };
}
