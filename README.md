# idempotent-http: Reusable Request and Response Bodies

## 1. Overview: Solving the "Body Already Used" Problem

For any developer who has worked extensively with the native Fetch API, the `TypeError: body used already` error is a familiar and often frustrating roadblock. This error arises from a core design principle of the underlying ReadableStream API: a stream's body is a single-use resource that, once consumed, cannot be read again. **idempotent-http** is a zero-configuration, drop-in library designed to eliminate this problem entirely by making native `Request` and `Response` objects inherently reusable.

By transparently patching the browser's native APIs, idempotent-http allows you to treat request and response bodies as if they were idempotent—that is, you can operate on them multiple times without changing their state or causing errors.

- **Read Multiple Times**: Consume response bodies in any format (`.json()`, `.text()`, `.blob()`, etc.) as many times as needed from the same `Response` object.
- **Reuse Requests**: Safely reuse a single `Request` object in multiple fetch calls without triggering consumption errors.
- **Zero-API**: There are no new functions to learn or architectural patterns to adopt. The library works by augmenting the native browser APIs you already use.

This simple yet powerful enhancement removes a common source of bugs and boilerplate code, enabling a more intuitive and robust approach to handling HTTP data. To fully appreciate its value, let's first examine the native limitation it solves.

## 2. The Core Problem: A Practical Example

The strategic foundation of `Request` and `Response` bodies is the `ReadableStream` object. Streams are designed for high-performance, memory-efficient data handling, allowing browsers to process large payloads without loading them entirely into memory. The trade-off for this efficiency is that they are designed for a single consumption pass. Once a stream is read—whether by calling `.json()`, `.text()`, or accessing the `.body` property—it becomes "locked" or "disturbed" and cannot be read again. This behavior, while logical from a stream-processing perspective, is often counter-intuitive for developers who expect objects to be reusable.

The following code demonstrates this native limitation. An attempt to read the response body a second time will inevitably fail.

```javascript
async function processResponse() {
  try {
    const response = await fetch('https://api.example.com/data');

    // First consumption: This works perfectly.
    const jsonData = await response.json();
    console.log('Parsed JSON:', jsonData);

    // Second consumption: This will throw an error.
    // The response body stream has already been read by .json() and is now "used".
    const textData = await response.text(); // -> TypeError: body used already
    console.log('Raw text:', textData);

  } catch (error) {
    console.error(error);
  }
}
```

This common scenario forces developers to manually clone responses or store results in intermediate variables, adding complexity to their code. The idempotent-http library provides an elegant solution to this very problem.

## 3. The Solution: Automatic & Transparent Cloning

The library's fundamental approach is to intercept any operation that would consume a `Request` or `Response` body. Before the original body stream is touched, idempotent-http seamlessly creates an in-memory clone of the object. It then performs the requested operation—such as `.json()` or `.text()`—on the clone's body, consuming it instead. This masterfully leaves the original object's body pristine and unlocked, ready for future use. This entire process is automatic and requires no changes to your application logic.

The library achieves this through a comprehensive patching strategy across several key web platform APIs:

| Patched API | Mechanism of Idempotency |
|-------------|--------------------------|
| `Request`, `Response`, `Blob` | Wraps all body-consuming methods (e.g., `.json()`, `.text()`, `.body`, `.arrayBuffer`) to operate on a clone created via the native `.clone()` or `.slice()` method. |
| `ReadableStream` | Intercepts consuming methods like `.getReader()`, `.tee()`, `.pipeThrough()`, and `.pipeTo()`. It leverages the native `Response` constructor as a factory: a new `Response` is created with the stream as its body, and its `.body` property is immediately accessed to yield a fresh, unlocked `ReadableStream`. |
| Global `fetch()` | Patches the global `fetch` function to automatically clone any `Request` object passed as an argument, preventing the original request from being consumed by the network call. |
| Global Constructors | Wraps the global `Request` and `Response` constructors to automatically clone any body-like arguments upon instantiation, preventing the original objects from being consumed. |

With the library active, the code from our previous example now works flawlessly without any modification.

```javascript
// Simply import the library at your application's entry point.
import 'idempotent-http';

async function processResponse() {
  try {
    const response = await fetch('https://api.example.com/data');

    // First consumption: This still works perfectly.
    const jsonData = await response.json();
    console.log('Parsed JSON:', jsonData);

    // Second consumption: This now succeeds!
    // The library automatically provided a clone for the .text() call,
    // leaving the original response object's body intact.
    const textData = await response.text();
    console.log('Raw text:', textData);

  } catch (error) {
    console.error(error);
  }
}
```

Now that we understand how the library solves the problem, let's review the simple steps for integrating it into a project.

## 4. Installation & Usage

The library is designed for maximum simplicity and is intended to be a "drop-in" module. It requires no configuration or initialization code—only a single import to activate its patching mechanism globally across your application.

### Installation

Install the package into your project using your preferred package manager.

```bash
npm install idempotent-http
```

### Usage

To activate the library, import it once at the entry point of your application (e.g., `index.js` or `main.ts`). This single import is sufficient to patch the relevant global APIs for all subsequent code.

```javascript
// src/index.js
import 'idempotent-http';

// ... the rest of your application code
// (e.g., import App from './App';)
```

From this point on, all instances of `Request`, `Response`, and `ReadableStream` will benefit from idempotent behavior. For those interested in the underlying implementation, the next section provides a deeper technical overview.

## 5. Under the Hood: Advanced Implementation Details

For developers interested in the advanced JavaScript techniques that enable the library's transparent functionality, this section explores the core implementation details. The "magic" is a combination of modern JavaScript features used to intercept and augment native behavior without breaking it, offering a level of metaprogramming that makes this non-destructive patching possible.

- **Proxy-based Interception**: The library leverages JavaScript `Proxy` objects to wrap the parent prototype of `Request`, `Response`, and `ReadableStream` (i.e., `Object.getPrototypeOf(Request.prototype)`). This injects the library's logic into the prototype chain without replacing the original. When your code attempts to access a method like `response.json()`, the proxy's `get` handler intercepts the call, triggers the cloning logic, and then executes the original method on the fresh clone. By patching the prototype, the library automatically covers every instance created anywhere in the application, making the solution truly "drop-in."

- **Dynamic Prototype Chaining**: To ensure patched objects behave exactly like their native counterparts, the library carefully manipulates prototype chains using `Object.setPrototypeOf`. An internal `sandwich` utility preserves prototype linkage for custom objects. For example, if you pass an instance of `class MyCustomRequest extends Request` to `fetch`, the library ensures the resulting object still has `MyCustomRequest.prototype` in its chain, preventing unexpected behavior and maintaining `instanceof` integrity.

- **Stream Management**: As a clever workaround for the lack of a native `stream.clone()` method, the library uses the `Response` constructor as a stream factory. However, this powerful technique is applied defensively. A `WeakSet` tracks all "library-managed" `ReadableStream` instances—those generated by its own patched methods. When a stream consumption method is called, the library checks this `WeakSet`. If the stream is one it created, it safely applies the Response-based cloning logic. If not, the stream is left untouched. This strategic tracking prevents the library from interfering with streams from external sources, demonstrating a robust and defensive design.

By combining these techniques, idempotent-http provides a powerful and seamless enhancement to the Fetch API, making it more resilient and developer-friendly.

## 6. Final Thoughts

idempotent-http addresses a common and persistent pain point in modern web development. By making `Request` and `Response` bodies inherently reusable, it simplifies asynchronous data handling and makes the native Fetch API behave more intuitively. The library's zero-configuration, drop-in nature eliminates a notorious class of runtime errors, reduces boilerplate code, and ultimately allows developers to focus on building more robust and predictable web applications.
