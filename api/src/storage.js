const path = require('node:path');
const { config } = require('./config');

const storageRoot = path.resolve(config.storageDir);

function resolveStoragePath(relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error('Caminho de storage invalido.');
  }

  const absolutePath = path.resolve(storageRoot, relativePath);

  if (absolutePath !== storageRoot && !absolutePath.startsWith(`${storageRoot}${path.sep}`)) {
    throw new Error('Caminho de storage fora da raiz permitida.');
  }

  return absolutePath;
}

module.exports = {
  storageRoot,
  resolveStoragePath,
};
