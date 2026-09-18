"use strict";

// Word stores a bookmark as a collapsed start marker rather than a range. When
// a bibliography bookmark starts exactly at the paragraph boundary, Pandoc
// reports the resulting empty anchor span at the END of the preceding entry.
// Attributing such an anchor to the entry it appears in silently cites the
// wrong reference and leaves the following entry unreachable, so an empty
// anchor with no text after it belongs to the entry that follows.

const is_anchor = (node) =>
  node.t === "Span" && node.c[0][1] && node.c[0][1][0] === "anchor";

// Flatten one bibliography entry into anchor markers and text, in reading order.
const read = (node, sequence = []) => {
  if (Array.isArray(node)) {
    node.forEach((child) => read(child, sequence));
    return sequence;
  }
  if (!node || typeof node !== "object" || node.t === undefined) return sequence;
  if (is_anchor(node)) {
    sequence.push({ anchor: node.c[0][0] });
    return read(node.c[1], sequence);
  }
  if (node.t === "Str") {
    sequence.push({ text: node.c });
    return sequence;
  }
  if (["Space", "SoftBreak", "LineBreak"].includes(node.t)) {
    sequence.push({ text: " " });
    return sequence;
  }
  return read(node.c, sequence);
};

const split_anchors = (item) => {
  const sequence = read(item);
  const own = [];
  const trailing = [];
  let text_follows = false;
  for (let index = sequence.length - 1; index >= 0; index--) {
    const element = sequence[index];
    if (element.anchor !== undefined) {
      (text_follows ? own : trailing).push(element.anchor);
    } else if (element.text.trim()) {
      text_follows = true;
    }
  }
  return { own: own.reverse(), trailing: trailing.reverse() };
};

// Return the Word anchors of each bibliography entry, in list order. One entry
// can own several anchors when Word merged duplicate references into it.
const bibliography_anchors = (items) => {
  const entries = items.map(split_anchors);
  return entries.map((entry, index) => [
    ...(index > 0 ? entries[index - 1].trailing : []),
    ...entry.own,
    // Nothing follows the last entry, so its trailing anchors are its own.
    ...(index === entries.length - 1 ? entry.trailing : []),
  ]);
};

module.exports = { bibliography_anchors };
