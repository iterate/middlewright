import { tsImport } from "tsx/esm/api";

export default (await tsImport("./src/lint/plugin.ts", import.meta.url)).default;
