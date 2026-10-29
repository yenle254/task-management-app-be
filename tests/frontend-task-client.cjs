// Executes the actual sibling frontend service/store in Node. Only native
// storage and the protected API origin are adapted for the isolated test server.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const project = path.resolve(__dirname, '../../project');
const frontendRequire = createRequire(path.join(project, 'package.json'));
const babel = frontendRequire('@babel/core');
module.exports = (token, baseURL, serviceOverride) => {
  const cache = new Map(), storage = new Map([['authToken', token]]);
  function load(filename) {
    const absolute = path.resolve(project, filename);
    if (absolute === path.join(project, 'src/config/api.config.js')) return { default: { BASE_URL: baseURL, TIMEOUT: 10000 }, __esModule: true };
    if (serviceOverride && absolute === path.join(project, 'src/services/taskService.js')) return { default: serviceOverride, __esModule: true };
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const mod = { exports: {} }; cache.set(absolute, mod);
    const code = babel.transformSync(fs.readFileSync(absolute,'utf8'), { filename:absolute,babelrc:false,configFile:false,plugins:[frontendRequire.resolve('@babel/plugin-transform-modules-commonjs')] }).code;
    const localRequire = name => name === '@react-native-async-storage/async-storage' ? { getItem:async key=>storage.get(key)??null,removeItem:async key=>storage.delete(key) } : name.startsWith('.') ? load(path.resolve(path.dirname(absolute),name.endsWith('.js')?name:`${name}.js`)) : frontendRequire(name);
    new Function('require','module','exports',code)(localRequire,mod,mod.exports);
    return mod.exports;
  }
  return { service: load('src/services/taskService.js').default, store: load('store/taskStore.js').default };
};
