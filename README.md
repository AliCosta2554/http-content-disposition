# HTTP Content Disposition

A small, dependency-free library for parsing and building `Content-Disposition` header values in JavaScript. It handles the common `inline`/`attachment` dispositions, the `filename` parameter, and the RFC 5987 `filename*` extended parameter for Unicode names.

```js
import {
  parseContentDisposition,
  buildContentDisposition,
} from './src/index.js';

const parsed = parseContentDisposition(
  "attachment; filename=fallback.txt; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf",
);
console.log(parsed['filename*']); // résumé.pdf

const header = buildContentDisposition({
  type: 'attachment',
  filename: 'résumé.pdf',
});
console.log(header); // attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf
```

## Why this exists

Most server frameworks expose a parsed version of this header, but the shape is inconsistent and often loses the distinction between `filename` and `filename*`. This library keeps both values distinct so the caller can decide which one to use. The trade-off is that parsing is strict: a malformed `filename*` throws an exception rather than silently falling back to the plain `filename`. That fallback is easy to add in application code if desired.

## Edge cases

When both `filename` and `filename*` are present, parsing returns both but `filename*` takes precedence for consumers that pick one value. Building always emits `filename*` for Unicode-safe transfer and adds a plain `filename` only when the name is an RFC 2616 token. Extended parameters are decoded only for UTF-8, as required by RFC 5987.
