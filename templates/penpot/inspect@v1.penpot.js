// Plugin API 2.17.2: File.pages and shared plugin data can be read without openPage (S5).
const file = penpot.currentFile;
const pages = [];
let unmanagedPages = 0;
if (file) {
  for (const page of file.pages) {
    const id = page.getSharedPluginData("heron", "id");
    if (!id) {
      unmanagedPages += 1;
      continue;
    }
    const mark = (key) => page.getSharedPluginData("heron", key) || null;
    pages.push({
      pageId: page.id,
      name: page.name,
      marks: {
        id,
        content: mark("content"),
        source: mark("source"),
        template: mark("template"),
        mode: mark("mode"),
      },
    });
  }
}
return {
  heron: "inspect@v1",
  penpotVersion: penpot.version,
  file: file ? { id: file.id, name: file.name } : null,
  pages,
  unmanagedPages,
};
