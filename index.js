  (() => {
    const streams = new WeakSet();
    const consumables = ['headers','body','arrayBuffer', 'blob', 'bytes', 'formData', 'json', 'text','stream'];
    // Apply to both request and response
    for (const Record of [Request, Response, Blob]) {
      const _clone = Record.prototype.clone ?? Record.prototype.slice;
      const $clone = (record) =>{
        const recordClone = _clone.call(record);
        Object.setPrototypeOf(recordClone.headers ?? {},record.headers ?? Headers.prototype);
        return Object.setPrototypeOf(recordClone,record);
      };
      // Apply to all functions that can consume the body
      for (const fn of consumables) {
        // skip if doesn't exist
        if (typeof Record.prototype[fn] !== 'function') continue;
        // store the native function
        const _fn = Record.prototype[fn];
        // Shadow the native function with a wrapper that clones first
        Record.prototype[fn] = Object.setPrototypeOf(function() {
          const result = _fn.call($clone(this));
          streams.add(result);
          return result;
        }, _fn);
        Object.defineProperty(Record.prototype[fn],'name',{get:()=>fn});
      }
      // Apply to the getter of the body itself
      const _body = Object.getOwnPropertyDescriptor(Record.prototype, 'body').get;
      if (_body) {
        Object.defineProperty(Record.prototype, 'body', {
          get:Object.setPrototypeOf(function body(){
            const $body = _body.call($clone(this));
            streams.add($body);
            return $body;
          },ReadableStream),
        });
      }
      Record.clone = Object.setPrototypeOf(function clone() {
          return $clone(this);
      }, _clone);
      const _RecordPrototype = Record.prototype;
      Record.prototype = new Proxy(_RecordPrototype,{
        get(target,key,receiver){
          if(consumables.includes(key)){
            return Reflect.get(...arguments);
          }
          const $this = $clone(receiver ?? target);
          const value = Reflect.get(target,key,$this);
          if(typeof value === 'function'){
            return value.bind($this);
          }
          return value;
        }
      });
    }

    const $clone = stream =>{
      if(streams.has(stream)){
        const $stream = new Response(stream).body;
        return Object.setPrototypeOf($stream,stream);
      }else{
        return stream;
      }
    };
    const consumables = ['getReader','tee','pipeThrough','pipeTo'];
    for(const fn of consumables){
      const _fn = ReadableStream.prototype[fn];
      ReadableStream.prototype[fn] = Object.setPrototypeOf(function(...args) {
          return _fn.apply($clone(this),args);
        }, _fn);
        Object.defineProperty(ReadableStream.prototype[fn],'name',{get:()=>fn});
      }
    }
   const _ReadableStreamPrototype = ReadableStream.prototype;
      ReadableStream.prototype = new Proxy(_ReadableStreamPrototype,{
        get(target,key,receiver){
          if(consumables.includes(key)){
            return Reflect.get(...arguments);
          }
          const $this = $clone(receiver ?? target);
          const value = Reflect.get(target,key,$this);
          if(typeof value === 'function'){
            return value.bind($this);
          }
          return value;
        }
      });
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

