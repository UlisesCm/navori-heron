/** Subset of plugins/libs/plugin-types/index.d.ts at Penpot 2.17.2 (C10).
 * Implement only the API consumed by the templates; never replace template logic. */
export type FakePenpotCounters = {
  reads: number;
  mutations: number;
  opens: number;
  created: number;
  removed: number;
};
type Track = { type: "auto" | "flex"; value?: number };
type FakeLayout = {
  dir: "row" | "column";
  wrap: "wrap" | "nowrap";
  rowGap: number;
  columnGap: number;
  topPadding: number;
  rightPadding: number;
  bottomPadding: number;
  leftPadding: number;
  readonly rows: Track[];
  readonly columns: Track[];
  addRow(type: Track["type"], value?: number): void;
  addColumn(type: Track["type"], value?: number): void;
};
type SharedData = {
  getSharedPluginData(namespace: string, key: string): string | null;
  setSharedPluginData(namespace: string, key: string, value: string): void;
};
export type FakeShape = SharedData & {
  readonly id: string;
  readonly type: "board" | "rect" | "text";
  name: string;
  x: number;
  y: number;
  readonly width: number;
  readonly height: number;
  fills: { fillColor: string; fillOpacity: number }[];
  strokes: {
    strokeColor: string;
    strokeWidth: number;
    strokeStyle: "solid" | "dashed";
    strokeOpacity: number;
    strokeAlignment: "inner";
  }[];
  borderRadius: number;
  verticalSizing: "auto" | "fix";
  horizontalSizing: "auto" | "fix";
  characters: string;
  fontFamily: string;
  fontWeight: string;
  fontSize: string;
  lineHeight: string;
  fontVariantId: string;
  growType: "fixed" | "auto-width" | "auto-height";
  readonly children: FakeShape[];
  readonly flex: FakeLayout | undefined;
  readonly grid: FakeLayout | undefined;
  resize(width: number, height: number): void;
  appendChild(shape: FakeShape): void;
  remove(): void;
  addFlexLayout(): FakeLayout;
  addGridLayout(): FakeLayout;
};
export type FakePage = SharedData & { readonly id: string; name: string; readonly root: FakeShape };
type Variant = { fontWeight: string; fontStyle: "normal" | "italic"; fontVariantId: string };
type FakeFont = {
  name: string;
  variants: Variant[];
  applyToText(text: FakeShape, variant?: Variant): void;
};
export type FakePenpot = {
  counters: FakePenpotCounters;
  /** Test controls, not part of the Penpot API. */
  controls: {
    failText: boolean;
    beforeOpen: ((page: FakePage) => Promise<void>) | null;
    afterMutation: ((operation: string) => void) | null;
  };
  penpot: {
    version: string;
    currentFile: { id: string; name: string; pages: FakePage[] } | null;
    readonly currentPage: FakePage | null;
    flags: { naturalChildOrdering: boolean; throwValidationErrors: boolean };
    fonts: { all: FakeFont[] };
    createPage(): FakePage;
    openPage(page: FakePage): Promise<void>;
    createBoard(): FakeShape;
    createRectangle(): FakeShape;
    createText(text: string): FakeShape | null;
  };
};

// FontsContext.all and Font.applyToText: S6 plus official string-weight variants.
function font(name: string): FakeFont {
  return {
    name,
    variants: [
      { fontWeight: "400", fontStyle: "normal", fontVariantId: "regular" },
      { fontWeight: "700", fontStyle: "normal", fontVariantId: "bold" },
    ],
    applyToText(text, variant): void {
      const selected = variant ?? { fontWeight: "400", fontVariantId: "regular" };
      text.fontFamily = name;
      text.fontWeight = selected.fontWeight;
      text.fontVariantId = selected.fontVariantId;
    },
  };
}
export function createFakePenpot(): FakePenpot {
  const counters: FakePenpotCounters = { reads: 0, mutations: 0, opens: 0, created: 0, removed: 0 };
  const controls: FakePenpot["controls"] = {
    failText: false,
    beforeOpen: null,
    afterMutation: null,
  };
  let sequence = 0;
  let active: FakePage | null = null;
  const parents = new WeakMap<FakeShape, FakeShape>();
  const childLists = new WeakMap<FakeShape, FakeShape[]>();
  const mutate = (operation: string): void => {
    counters.mutations += 1;
    controls.afterMutation?.(operation);
  };
  // T12 live 2.17.2: missing shared data returns null despite the published string return type.
  const shared = (): SharedData => {
    const data = new Map<string, Map<string, string>>();
    return {
      getSharedPluginData(namespace, key): string | null {
        counters.reads += 1;
        return data.get(namespace)?.get(key) ?? null;
      },
      setSharedPluginData(namespace, key, value): void {
        if (typeof value !== "string") throw new TypeError("shared plugin data must be a string");
        let entries = data.get(namespace);
        if (!entries) {
          entries = new Map();
          data.set(namespace, entries);
        }
        entries.set(key, value);
        mutate(`mark:${key}`);
      },
    };
  };
  // CommonLayout/FlexLayout/GridLayout: wrap enum and track method signatures, not arrays assigned by callers.
  const layout = (): FakeLayout => {
    const rows: Track[] = [];
    const columns: Track[] = [];
    return new Proxy<FakeLayout>(
      {
        dir: "row",
        wrap: "nowrap",
        rowGap: 0,
        columnGap: 0,
        topPadding: 0,
        rightPadding: 0,
        bottomPadding: 0,
        leftPadding: 0,
        get rows(): Track[] {
          return [...rows];
        },
        get columns(): Track[] {
          return [...columns];
        },
        addRow(type, value): void {
          add(rows, type, value);
        },
        addColumn(type, value): void {
          add(columns, type, value);
        },
      },
      {
        set(target, property, value: unknown): boolean {
          if (property === "rows" || property === "columns")
            throw new TypeError("tracks are readonly");
          if (property === "wrap" && value !== "wrap" && value !== "nowrap")
            throw new TypeError("invalid flex wrap");
          if (property === "dir" && value !== "row" && value !== "column")
            throw new TypeError("invalid layout direction");
          if (
            typeof property === "string" &&
            /Gap$|Padding$/.test(property) &&
            (typeof value !== "number" || !Number.isFinite(value))
          )
            throw new TypeError("invalid layout dimension");
          Reflect.set(target, property, value);
          mutate(`layout:${String(property)}`);
          return true;
        },
      },
    );
    function add(tracks: Track[], type: Track["type"], value: number | undefined): void {
      if (type !== "auto" && type !== "flex") throw new TypeError("invalid grid track");
      if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value)))
        throw new TypeError("invalid grid track value");
      tracks.push(value === undefined ? { type } : { type, value });
      mutate("track");
    }
  };
  // ShapeBase dimensions are readonly; resize is the mutation API. S5 validates parent/child creation.
  const shape = (type: FakeShape["type"], characters = ""): FakeShape => {
    let width = 100;
    let height = 20;
    let flex: FakeLayout | undefined;
    let grid: FakeLayout | undefined;
    const childList: FakeShape[] = [];
    const target: FakeShape = {
      ...shared(),
      id: `shape-${++sequence}`,
      type,
      name: type,
      x: 0,
      y: 0,
      get width(): number {
        return width;
      },
      get height(): number {
        return height;
      },
      fills: [],
      strokes: [],
      borderRadius: 0,
      verticalSizing: "fix",
      horizontalSizing: "fix",
      characters,
      fontFamily: "Default",
      fontWeight: "400",
      fontSize: "16",
      lineHeight: "1.2",
      fontVariantId: "regular",
      growType: "fixed",
      // Flags.naturalChildOrdering: appendChild adds at the end, getters return a fresh snapshot.
      get children(): FakeShape[] {
        return [...childList];
      },
      get flex(): FakeLayout | undefined {
        return flex;
      },
      get grid(): FakeLayout | undefined {
        return grid;
      },
      resize(w, h): void {
        if (
          ![w, h].every((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
        )
          throw new TypeError("invalid shape dimensions");
        width = w;
        height = h;
        mutate("resize");
      },
      appendChild(child): void {
        if (type !== "board") throw new TypeError("only boards can contain children");
        const old = parents.get(child);
        const oldChildren = old ? childLists.get(old) : undefined;
        if (oldChildren) oldChildren.splice(oldChildren.indexOf(child), 1);
        childList.push(child);
        parents.set(child, proxy);
        mutate("appendChild");
      },
      remove(): void {
        const parent = parents.get(proxy);
        const siblings = parent ? childLists.get(parent) : undefined;
        if (siblings) siblings.splice(siblings.indexOf(proxy), 1);
        parents.delete(proxy);
        counters.removed += 1;
        mutate("remove");
      },
      addFlexLayout(): FakeLayout {
        if (type !== "board") throw new TypeError("only boards have layouts");
        flex = layout();
        mutate("flex");
        return flex;
      },
      addGridLayout(): FakeLayout {
        if (type !== "board") throw new TypeError("only boards have layouts");
        grid = layout();
        mutate("grid");
        return grid;
      },
    };
    const proxy = new Proxy(target, {
      get(object, property, receiver): unknown {
        counters.reads += 1;
        return Reflect.get(object, property, receiver);
      },
      set(object, property, value: unknown): boolean {
        if (
          ["width", "height", "id", "type", "children", "flex", "grid"].includes(String(property))
        )
          throw new TypeError("readonly shape property");
        // Text properties in 2.17.2 are strings, not numeric node values.
        if (
          [
            "fontSize",
            "fontWeight",
            "lineHeight",
            "fontFamily",
            "fontVariantId",
            "characters",
            "name",
          ].includes(String(property)) &&
          typeof value !== "string"
        )
          throw new TypeError("text properties must be strings");
        if (
          property === "growType" &&
          !["fixed", "auto-width", "auto-height"].includes(String(value))
        )
          throw new TypeError("invalid text growType");
        Reflect.set(object, property, value);
        mutate(`shape:${String(property)}`);
        return true;
      },
    });
    childLists.set(proxy, childList);
    counters.created += 1;
    mutate(`create:${type}`);
    return proxy;
  };
  const attach = (type: FakeShape["type"], text?: string): FakeShape => {
    if (!active) throw new Error("no active page");
    const created = shape(type, text);
    active.root.appendChild(created);
    return created;
  };
  const penpot: FakePenpot["penpot"] = {
    version: "2.17.2",
    currentFile: { id: "file-1", name: "Test file", pages: [] },
    get currentPage(): FakePage | null {
      return active;
    },
    flags: { naturalChildOrdering: false, throwValidationErrors: false },
    fonts: { all: [font("Inter Tight"), font("Inter")] },
    // Context.createPage: adds a page to currentFile without switching the active page (S5).
    createPage(): FakePage {
      if (!penpot.currentFile) throw new Error("no open file");
      const page: FakePage = new Proxy(
        { ...shared(), id: `page-${++sequence}`, name: "New page", root: shape("board") },
        {
          set(object, property, value: unknown): boolean {
            if (property !== "name" || typeof value !== "string")
              throw new TypeError("invalid page property");
            Reflect.set(object, property, value);
            mutate("page:name");
            return true;
          },
        },
      );
      penpot.currentFile.pages.push(page);
      mutate("createPage");
      return page;
    },
    // Context.openPage is async; resolving the controlled wait switches the page before shapes are created (S5).
    async openPage(page): Promise<void> {
      counters.opens += 1;
      if (controls.beforeOpen) await controls.beforeOpen(page);
      active = page;
    },
    createBoard(): FakeShape {
      return attach("board");
    },
    createRectangle(): FakeShape {
      return attach("rect");
    },
    // Context.createText(text): nullable; preserve the failure behavior instead of auto-creating a shape.
    createText(text): FakeShape | null {
      if (typeof text !== "string") throw new TypeError("createText requires characters");
      return controls.failText ? null : attach("text", text);
    },
  };
  return { counters, controls, penpot };
}

/** ExecuteCodeTaskHandler at tag 2.17.2 runs an async body with these bindings and temporary flags. */
export async function runPenpotScript(fake: FakePenpot, code: string): Promise<unknown> {
  const previous = { ...fake.penpot.flags };
  fake.penpot.flags.naturalChildOrdering = true;
  fake.penpot.flags.throwValidationErrors = true;
  try {
    const execute = new Function(
      "penpot",
      "penpotUtils",
      "storage",
      "console",
      `return (async () => {${code}})();`,
    );
    return await execute(
      fake.penpot,
      {},
      {},
      {
        log(): never {
          throw new Error("templates must not log");
        },
      },
    );
  } finally {
    Object.assign(fake.penpot.flags, previous);
  }
}
