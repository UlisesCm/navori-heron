export const ATTRIBUTE_KEYS = [
  "personality",
  "density",
  "surfaceTreatment",
  "typographyStrategy",
  "colorStrategy",
  "imageryStrategy",
  "navigationCharacter",
  "componentWeight",
  "motionCharacter",
  "references",
  "risks",
  "whenItFits",
  "whenItDoesnt",
] as const;
export type PenpotCopyKey =
  | (typeof ATTRIBUTE_KEYS)[number]
  | "passes"
  | "fails"
  | "palette"
  | "typeScale"
  | "components"
  | "composition"
  | "attributes"
  | "referencesCited"
  | "doNotCopy"
  | "referenceOnly"
  | "synthetic"
  | "source"
  | "origin"
  | "reason"
  | "studies"
  | "influences"
  | "crops"
  | "imageNotShown"
  | "image"
  | "slot"
  | "button"
  | "text-input"
  | "card"
  | "badge"
  | "navigation"
  | "list-item"
  | "tabs"
  | "dialog"
  | "toggle"
  | "avatar";
export type PenpotCopy = Readonly<Record<PenpotCopyKey, string>>;
const en: PenpotCopy = {
  passes: "PASS",
  fails: "FAIL",
  palette: "Palette",
  typeScale: "Type scale",
  components: "Components",
  composition: "Composition",
  attributes: "Attributes",
  referencesCited: "References cited",
  doNotCopy: "Do not copy",
  referenceOnly: "REFERENCE ONLY",
  synthetic: "SYNTHETIC sample content",
  personality: "Personality",
  density: "Density",
  surfaceTreatment: "Surface treatment",
  typographyStrategy: "Typography strategy",
  colorStrategy: "Color strategy",
  imageryStrategy: "Imagery strategy",
  navigationCharacter: "Navigation character",
  componentWeight: "Component weight",
  motionCharacter: "Motion character",
  references: "References",
  risks: "Risks",
  whenItFits: "When it fits",
  whenItDoesnt: "When it does not fit",
  source: "Source",
  origin: "Origin",
  reason: "Reason",
  studies: "What it studies",
  influences: "Decisions it influences",
  crops: "Crops",
  imageNotShown: "Image not shown in P12",
  image: "IMAGE",
  slot: "SLOT",
  button: "Button",
  "text-input": "Text input",
  card: "Card",
  badge: "Badge",
  navigation: "Navigation",
  "list-item": "List item",
  tabs: "Tabs",
  dialog: "Dialog",
  toggle: "Toggle",
  avatar: "Avatar",
};
const es: PenpotCopy = {
  passes: "CUMPLE",
  fails: "NO CUMPLE",
  palette: "Paleta",
  typeScale: "Escala tipográfica",
  components: "Componentes",
  composition: "Composición",
  attributes: "Atributos",
  referencesCited: "Referencias citadas",
  doNotCopy: "Qué no copiar",
  referenceOnly: "SOLO REFERENCIA",
  synthetic: "Contenido de muestra SYNTHETIC",
  personality: "Personalidad",
  density: "Densidad",
  surfaceTreatment: "Tratamiento de superficie",
  typographyStrategy: "Estrategia tipográfica",
  colorStrategy: "Estrategia de color",
  imageryStrategy: "Estrategia de imágenes",
  navigationCharacter: "Carácter de navegación",
  componentWeight: "Peso de componentes",
  motionCharacter: "Carácter de movimiento",
  references: "Referencias",
  risks: "Riesgos",
  whenItFits: "Cuándo encaja",
  whenItDoesnt: "Cuándo no encaja",
  source: "Fuente",
  origin: "Origen",
  reason: "Razón",
  studies: "Qué se estudia",
  influences: "Decisiones que influye",
  crops: "Recortes",
  imageNotShown: "Imagen no mostrada en P12",
  image: "IMAGEN",
  slot: "ESPACIO",
  button: "Botón",
  "text-input": "Campo de texto",
  card: "Tarjeta",
  badge: "Etiqueta",
  navigation: "Navegación",
  "list-item": "Elemento de lista",
  tabs: "Pestañas",
  dialog: "Diálogo",
  toggle: "Interruptor",
  avatar: "Avatar",
};
export const PENPOT_COPY: Readonly<Record<"en" | "es", PenpotCopy>> = { en, es };
export function resolvePenpotCopy(locale: string | null): PenpotCopy {
  return locale?.split("-")[0]?.toLowerCase() === "es" ? es : en;
}
