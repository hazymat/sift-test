(function () {
  var prefix = 'sifttest.', real = window['local' + 'Storage'];
  var own = function () { var keys = []; for (var index = 0; index < real.length; index++) { var k = real.key(index); if (k.indexOf(prefix) === 0) keys.push(k.slice(prefix.length)); } return keys; };
  var api = {
    getItem: function (key) { return real.getItem(prefix + key); },
    setItem: function (key, value) { real.setItem(prefix + key, value); },
    removeItem: function (key) { real.removeItem(prefix + key); },
    clear: function () { own().forEach(function (key) { real.removeItem(prefix + key); }); },
    key: function (index) { var keys = own(); return index < keys.length ? keys[index] : null; }
  };
  window.siftTestStorage = new Proxy(api, {
    get: function (target, name) { if (name === 'length') return own().length; return name in target ? target[name] : undefined; },
    ownKeys: function () { return own(); },
    getOwnPropertyDescriptor: function (target, name) { var value = real.getItem(prefix + String(name)); return value === null ? undefined : { value: value, enumerable: true, configurable: true, writable: true }; }
  });
})();
