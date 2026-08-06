import path from "node:path";
import { pathToFileURL } from "node:url";

export async function importFresh(projectRoot, relativePath) {
  const url = pathToFileURL(path.join(projectRoot, relativePath));
  url.searchParams.set("testRun", `${Date.now()}-${Math.random()}`);
  return import(url.href);
}
