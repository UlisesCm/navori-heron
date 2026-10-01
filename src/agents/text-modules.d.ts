/** Prompt templates are imported with `with { type: "text" }` (Bun text loader); tsc only needs the module shape. */
declare module "*.md" {
  const text: string;
  export default text;
}
