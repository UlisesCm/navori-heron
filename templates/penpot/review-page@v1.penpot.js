// All external values come from HERON, produced by the sole renderer (DR11).
const file = penpot.currentFile;
if (!file) throw new Error("no Penpot file is open");
const spec = HERON.page;
const prefix = spec.heronId + "/";
const mark = (shape) => shape.getSharedPluginData("heron", "id");
const owned = (shape) => mark(shape).startsWith(prefix);
const children = (shape) => shape.children || [];
const descendants = (root) => {
  const result = [];
  const visit = (shape) => {
    result.push(shape);
    for (const child of children(shape)) visit(child);
  };
  for (const child of children(root)) visit(child);
  return result;
};
// Validate unique keys before any mutation, including creation of a page.
const expected = new Set();
const collect = (nodes) => {
  for (const node of nodes) {
    const id = prefix + node.key;
    if (expected.has(id)) throw new Error("duplicate Heron node key");
    expected.add(id);
    if (node.type === "board") collect(node.children);
  }
};
collect(HERON.nodes);
let page = file.pages.find((candidate) => candidate.id === HERON.targetPageId);
const created = !page;
if (!page) {
  page = penpot.createPage();
  page.setSharedPluginData("heron", "id", spec.heronId);
} else if (page.getSharedPluginData("heron", "id") !== spec.heronId) {
  throw new Error("target page is not marked for this Heron page");
}
await penpot.openPage(page);
const humanShapes = () => {
  const names = [];
  const seen = new Set();
  for (const shape of descendants(page.root).filter(owned)) {
    for (const child of descendants(shape)) {
      // A foreign mark is not permission to delete another plugin's work either.
      if (!owned(child) && !seen.has(child.id)) {
        seen.add(child.id);
        if (names.length < 10) names.push(child.name);
      }
    }
  }
  return names;
};
const result = (outcome, shapes, fontFallbacks, human) => ({
  heron: "review-page@v1",
  pageId: page.id,
  outcome,
  created,
  shapes,
  fontFallbacks,
  humanShapes: human,
});
const human = humanShapes();
if (human.length) return result("human-shapes", 0, [], human);
page.setSharedPluginData("heron", "content", "");
const removeOwned = (root) => {
  // Capture a snapshot before remove mutates the container.
  const snapshot = [...children(root)];
  for (const shape of snapshot) {
    if (owned(shape)) shape.remove();
    else removeOwned(shape);
  }
};
removeOwned(page.root);
const fallback = new Set();
const written = new Map();
const draw = (node, parent) => {
  const shape =
    node.type === "board"
      ? penpot.createBoard()
      : node.type === "rect"
        ? penpot.createRectangle()
        : penpot.createText(node.characters);
  if (!shape) throw new Error("Penpot could not create a text shape");
  const id = prefix + node.key;
  shape.setSharedPluginData("heron", "id", id);
  written.set(id, shape.id);
  shape.name = node.name;
  if (node.type === "text") {
    const font = penpot.fonts.all.find(
      (candidate) => candidate.name.toLowerCase() === node.fontFamily.toLowerCase(),
    );
    if (font) {
      const variant = font.variants.find(
        (candidate) =>
          candidate.fontWeight === String(node.fontWeight) && candidate.fontStyle === "normal",
      );
      if (variant) font.applyToText(shape, variant);
      else font.applyToText(shape);
    } else fallback.add(node.fontFamily);
    shape.fontSize = String(node.fontSize);
    shape.fontWeight = String(node.fontWeight);
    shape.lineHeight = String(node.lineHeight);
    shape.fills = [{ fillColor: node.color, fillOpacity: 1 }];
    if (node.width === null) shape.growType = "auto-width";
    else {
      shape.resize(node.width, shape.height);
      shape.growType = "auto-height";
    }
  } else {
    shape.resize(node.width, node.height === null ? 1 : node.height);
    shape.fills = node.fill === null ? [] : [{ fillColor: node.fill, fillOpacity: 1 }];
    shape.borderRadius = node.radius;
    shape.strokes =
      node.stroke === null
        ? []
        : [
            {
              strokeColor: node.stroke.color,
              strokeWidth: node.stroke.width,
              strokeStyle: node.stroke.style,
              strokeOpacity: 1,
              strokeAlignment: "inner",
            },
          ];
  }
  if (parent) parent.appendChild(shape);
  if (node.type === "board") {
    shape.x = node.x;
    shape.y = node.y;
    if (node.layout) {
      const layout = node.layout.kind === "flex" ? shape.addFlexLayout() : shape.addGridLayout();
      layout.rowGap = node.layout.gap;
      layout.columnGap = node.layout.gap;
      layout.topPadding = node.layout.padding;
      layout.rightPadding = node.layout.padding;
      layout.bottomPadding = node.layout.padding;
      layout.leftPadding = node.layout.padding;
      shape.verticalSizing = node.height === null ? "auto" : "fix";
      shape.horizontalSizing = "fix";
      if (node.layout.kind === "flex") {
        layout.dir = node.layout.dir;
        layout.wrap = node.layout.wrap ? "wrap" : "nowrap";
      } else {
        layout.dir = "row";
        for (let index = 0; index < node.layout.columns; index += 1) layout.addColumn("flex", 1);
        for (
          let index = 0;
          index < Math.ceil(node.children.length / node.layout.columns);
          index += 1
        )
          layout.addRow("auto");
      }
    }
    for (const child of node.children) draw(child, shape);
  }
};
for (const node of HERON.nodes) draw(node, null);
page.name = spec.name;
page.setSharedPluginData("heron", "source", spec.sourceSha256);
page.setSharedPluginData("heron", "template", spec.template);
page.setSharedPluginData("heron", "mode", spec.mode);
// Compare actual shape identities as well as unique keys: a competing write can reuse keys.
const actual = descendants(page.root).filter(owned);
const found = new Set(actual.map(mark));
if (
  actual.length !== expected.size ||
  found.size !== expected.size ||
  actual.some((shape) => !expected.has(mark(shape)) || written.get(mark(shape)) !== shape.id)
) {
  // A late writer may have restored content after our initial clear (DR45).
  page.setSharedPluginData("heron", "content", "");
  if (!humanShapes().length) removeOwned(page.root);
  return result("conflict", 0, [...fallback], []);
}
page.setSharedPluginData("heron", "content", spec.contentSha256);
return result("written", written.size, [...fallback], []);
