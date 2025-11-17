  (() => {
    // Apply to both request and response
    for (const Record of [Request, Response, Blob]) {
      const _clone = Record.prototype.clone ?? Record.prototype.slice;
      const $clone = (record) =>{
        const recordClone = _clone.call(record);
        Object.setPrototypeOf(recordClone.headers ?? {},record.headers ?? Headers.prototype);
        return Object.setPrototypeOf(recordClone,record);
      };
      // Apply to all functions that can consume the body
      for (const fn of ['arrayBuffer', 'blob', 'bytes', 'formData', 'json', 'text','stream']) {
        // skip if doesn't exist
        if (typeof Record.prototype[fn] !== 'function') continue;
        // store the native function
        const _fn = Record.prototype[fn];
        // Shadow the native function with a wrapper that clones first
        Record.prototype[fn] = Object.setPrototypeOf(function() {
          return _fn.call($clone(this));
        }, _fn);
        Object.defineProperty(Record.prototype[fn],'name',{get:()=>fn});
      }
      // Apply to the getter of the body itself
      const _body = Object.getOwnPropertyDescriptor(Record.prototype, 'body').get;
      if (_body) {
        Object.defineProperty(Record.prototype, 'body', {
          get:Object.setPrototypeOf(function body(){
          return _body.call($clone(this));
        },ReadableStream),
        });
      }
      Record.clone = Object.setPrototypeOf(function clone() {
          return $clone(this);
      }, _clone);
    }
  })();

  // clone inputs to the constructors so they don't get consumed
  (()=>{
    const _Request = Request;
    const $Request = class Request extends _Request{
      constructor(...args){
         super(...args.map(x=>x?.clone?.() ?? x));
      }
    };
    globalThis.Request = $Request;
  })();

  (()=>{
    const _Response = Response;
    const $Response = class Response extends _Response{
      constructor(...args){
         super(...args.map(x=>x?.clone?.() ?? x));
      }
    };
    globalThis.Response = $Response;
  })();

  // patch fetch to not consume requests
  (()=>{
    const _fetch = fetch;
    globalThis.fetch = Object.setPrototypeOf(function fetch(...args){
      return _fetch.apply(this,args.map(x=>x?.clone?.() ?? x));
    },_fetch);
  })();

