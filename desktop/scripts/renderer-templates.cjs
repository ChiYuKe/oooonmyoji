const fs = require('node:fs');
const path = require('node:path');

const INCLUDE = /<!--\s*@include:\s*([^\s]+)\s*-->/g;
const LOCAL_CSS_IMPORT = /@import\s+(?:url\()?(["'])(\.{1,2}\/[^"']+)\1\)?\s*;/g;

function resolveWithin(root, relativePath) {
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Renderer include escapes its root: ${relativePath}`);
  }
  return resolved;
}

function expandTemplate(source, root, stack = []) {
  const absoluteRoot = path.resolve(root);
  return source.replace(INCLUDE, (_match, relativePath) => {
    const filename = resolveWithin(absoluteRoot, relativePath);
    if (stack.includes(filename)) {
      throw new Error(`Renderer template include cycle: ${[...stack, filename].join(' -> ')}`);
    }
    const included = fs.readFileSync(filename, 'utf8');
    return expandTemplate(included, absoluteRoot, [...stack, filename]);
  });
}

function readExpandedHtml(filename, root = path.dirname(filename)) {
  const absoluteRoot = path.resolve(root);
  const source = fs.readFileSync(filename, 'utf8');
  const relativePageDir = path.relative(absoluteRoot, path.dirname(filename));
  return expandTemplate(source, path.resolve(absoluteRoot, relativePageDir));
}

function expandLocalCss(source, filename, root) {
  const absoluteRoot = path.resolve(root);
  return source.replace(LOCAL_CSS_IMPORT, (_match, _quote, relativePath) => {
    const resolved = resolveWithin(path.dirname(filename), relativePath);
    const relative = path.relative(absoluteRoot, resolved);
    if (relative.startsWith('..')) {
      throw new Error(`Stylesheet include escapes renderer root: ${relativePath}`);
    }
    const included = fs.readFileSync(resolved, 'utf8');
    return expandLocalCss(included, resolved, absoluteRoot);
  });
}

function readExpandedCss(filename, root = path.resolve(path.dirname(filename))) {
  const absoluteFilename = path.resolve(filename);
  const absoluteRoot = path.resolve(root);
  return expandLocalCss(fs.readFileSync(absoluteFilename, 'utf8'), absoluteFilename, absoluteRoot);
}

module.exports = { expandTemplate, readExpandedHtml, readExpandedCss };
