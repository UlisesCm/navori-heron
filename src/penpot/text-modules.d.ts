/** Bun text imports keep templates in compiled binaries without runtime filesystem reads. */
declare module "*.penpot.js" {
  const text: string;
  export default text;
}
