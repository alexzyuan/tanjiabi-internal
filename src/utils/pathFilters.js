const metadataNames = new Set([
  ".DS_Store",
  ".AppleDouble",
  ".LSOverride",
  "__MACOSX",
]);

const localOnlyNames = new Set([
  ".deploy-tmp",
  ".git",
  ".playwright-cli",
  "data-cache",
  "node_modules",
  "output",
  "releases",
  "uploads",
]);

function pathSegments(filePath) {
  return String(filePath || "")
    .split(/[\\/]+/)
    .filter(Boolean);
}

export function isRepositoryMetadataPath(filePath) {
  return pathSegments(filePath).some((segment) => (
    segment.startsWith("._")
    || metadataNames.has(segment)
  ));
}

export function isSourceTraversalPath(filePath) {
  const segments = pathSegments(filePath);
  if (!segments.length || isRepositoryMetadataPath(filePath)) return false;

  if (segments.some((segment) => localOnlyNames.has(segment) || segment.startsWith(".deploy-tmp-"))) {
    return false;
  }

  const name = segments.at(-1);
  if (name === "tanjia-bi-deploy.tar.gz" || name?.endsWith(".log")) {
    return false;
  }

  return true;
}
