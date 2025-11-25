(() => {
  // Utility: proxyPrototype(proto, handler)
  // Wraps a prototype with a Proxy on its parent prototype.
  // This allows intercepting property access (`get`, etc.) transparently.
  const proxyPrototype = (proto, handler = {}) => {
    const target = Object.getPrototypeOf(proto) ?? {};
    Object.setPrototypeOf(proto, new Proxy(target, handler));
    return proto;
  };

  const sandwich = ()=>{
    const protos = ['prototype','__proto__'];
    return (object, filling) => {
      try{
        const top = Object.getPrototypeOf(object);
        const bottom = new Proxy({},{
          get(target,key,receiver){
            if(protos.includes(String(key))){
              return Reflect.construct(...arguments);
            }
            return top[key];
          }
        });
        Object.setPrototypeOf(filling,top);
        Object.setPrototypeOf(bottom,filling);
        Object.setPrototypeOf(bottom,object);
      }catch(e){
        console.warn(e);
      }
      return object;
    };
  })();
  
  // Track all readable streams produced by consumable methods
  const streams = new WeakSet();

  // List of properties/methods that consume or expose body data
  const consumables = [
    'headers', 'body', 'arrayBuffer', 'blob', 'bytes',
    'formData', 'json', 'text', 'stream'
  ];

  // Apply patches to multiple built-in classes that deal with bodies
  for (const Record of [Request, Response, Blob]) {

    // Determine appropriate clone method (slice for Blob, clone for others)
    const _clone = Record.prototype.clone ?? Record.prototype.slice;

    // Helper: fully clone a record and restore its prototype chain
    const $clone = (record) => {
      const recordClone = _clone.call(record);
      // Preserve the headers object chain (so patched methods still apply)
      Object.setPrototypeOf(recordClone.headers ?? {}, record.headers ?? Headers.prototype);
      // Link the clone prototype to the original for inherited behavior
      try{
        Object.setPrototypeOf(recordClone.body, record.body);
      }catch{}
      return Object.setPrototypeOf(recordClone, record);
    };

    // Patch all known body-consuming functions
    for (const fn of consumables) {
      if (typeof Record.prototype[fn] !== 'function') continue; // skip if method missing

      const _fn = Record.prototype[fn]; // save native implementation

      // Replace method with wrapper that clones before consuming
      Record.prototype[fn] = Object.setPrototypeOf(function() {
        const result = _fn.call($clone(this)); // run on a safe clone
        streams.add(result);                   // track resulting stream
        return result;                         // return the safe result
      }, _fn);

      // Keep method name readable in stack traces
      Object.defineProperty(Record.prototype[fn], 'name', { get: () => fn });
    }

    // Patch `.body` getter to auto-clone before returning stream
    const _body = Object.getOwnPropertyDescriptor(Record.prototype, 'body')?.get;
    if (_body) {
      Object.defineProperty(Record.prototype, 'body', {
        get: Object.setPrototypeOf(function body() {
          const $body = _body.call($clone(this)); // get from cloned record
          streams.add($body);                     // track it for later cloning
          return $body;
        }, ReadableStream),
      });
    }

    // Add static `.clone()` convenience on constructor (Request.clone(), etc.)
    Record.clone = Object.setPrototypeOf(function clone() {
      return $clone(this);
    }, _clone);

    // Proxy the prototype so that property access also triggers safe cloning.
    proxyPrototype(Record.prototype, {
      get(target, key, receiver) {
        // Don’t intercept consumable members (already wrapped)
        if (consumables.includes(key)) {
          return Reflect.get(...arguments);
        }

        // Clone receiver before accessing other properties
        const $this = $clone(receiver ?? target);
        const value = Reflect.get(target, key, $this);

        // If method, bind it to the cloned instance
        if (typeof value === 'function') {
          return value.bind($this);
        }
        return value;
      }
    });
  }

  // Helper to safely clone readable streams when reused
  const $clone = (stream) => {
    if (streams.has(stream)) {
      // Wrap stream in Response to obtain a new readable body
      const $stream = new Response(stream).body;
      // Retain original prototype for type consistency
      return Object.setPrototypeOf($stream, stream);
    } else {
      // Non-tracked streams pass through unchanged
      return stream;
    }
  };

  // Methods that consume or transform streams
  const streamConsumables = ['getReader', 'tee', 'pipeThrough', 'pipeTo'];

  // Patch ReadableStream prototype to clone when consuming
  for (const fn of streamConsumables) {
    const _fn = ReadableStream.prototype[fn];
    ReadableStream.prototype[fn] = Object.setPrototypeOf(function(...args) {
      return _fn.apply($clone(this), args); // operate on a cloned stream
    }, _fn);

    Object.defineProperty(ReadableStream.prototype[fn], 'name', { get: () => fn });
  }

  // Proxy ReadableStream prototype for automatic safe binding/cloning
  proxyPrototype(ReadableStream.prototype, {
    get(target, key, receiver) {
      if (streamConsumables.includes(key)) {
        return Reflect.get(...arguments);
      }
      const $this = $clone(receiver ?? target);
      const value = Reflect.get(target, key, $this);
      if (typeof value === 'function') {
        return value.bind($this);
      }
      return value;
    }
  });

})(); // end main IIFE

isRequest = x => x instanceof Request || x?.constructor?.name == 'Request';
isResponse = x => x instanceof Response || x?.constructor?.name == 'Response';
isReadableStream = x => x instanceof ReadableStream || x?.constructor?.name == 'ReadableStream';
isHeaders = x => x instanceof Headers || x?.constructor?.name == 'Headers';
isObject = x => (typeof x === 'object' && x !== null) || typeof x === 'function';
// ---- Global constructors ----
// Each constructor clones its inputs to prevent consumption side-effects.

(() => {
  const _Request = Request;
  const $Request = class Request extends _Request {
    constructor(...args) {
      // Automatically clone any cloneable input arguments
      const $this = super(...args.map(x => x?.clone?.() ?? x));
      let $that;
      if(isObject(args[1])){
        $that = args[1];
      }else if(isObject(args[0])){
        $that = args[0];
      }
      if(isObject($that)){
        if(isRequest($that)){
          Object.setPrototypeOf($this,$that);
        }else{
          sandwich($this,$that);
        }
        if(isObject($that.body)){
          if(isReadableStream($that.body)){
            Object.setPrototypeOf($this.body,$that.body);
          }else{
            sandwich($this.body,$that.body);
          }
        }
      }
    }
  };
  globalThis.Request = $Request;
})();

(() => {
  const _Response = Response;
  const $Response = class Response extends _Response {
    constructor(...args) {
      // Automatically clone any cloneable input arguments
      super(...args.map(x => x?.clone?.() ?? x));
    }
  };
  globalThis.Response = $Response;
})();


// ---- fetch patch ----
// Ensures requests/responses passed to fetch() are cloned,
// preventing their bodies from being consumed.

(() => {
  const _fetch = fetch;
  globalThis.fetch = Object.setPrototypeOf(function fetch(...args) {
    return _fetch.apply(this, args.map(x => x?.clone?.() ?? x));
  }, _fetch);
})();
