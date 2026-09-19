// Parses and builds Content-Disposition header values.
//
// The header format is described by RFC 6266 for the `filename` parameter and
// RFC 5987 for `filename*` extended parameters. This module intentionally
// implements a deliberately small subset: `inline`/`attachment` disposition
// type, `filename`, `filename*`, and arbitrary fallback parameters. It does
// not validate the full grammar of RFC 2616 tokens; it validates enough to
// make round-tripping safe.

const TOKEN_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const EXTENDED_VALUE_RE = /^([A-Za-z0-9!#$&+.^_`|~-]+)'([^']*)'(.*)$/;

/**
 * Decode a percent-encoded string as UTF-8. Throws on malformed input.
 *
 * @param {string} input
 * @returns {string}
 */
function percentDecode(input) {
  try {
    return decodeURIComponent(input);
  } catch {
    throw new TypeError('Malformed extended parameter value');
  }
}

/**
 * Encode a string as percent-encoded UTF-8 for an RFC 5987 extended value.
 *
 * @param {string} input
 * @returns {string}
 */
function percentEncode(input) {
  return encodeURIComponent(input).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Parse a quoted-string value, including escapes.
 *
 * @param {string} input
 * @returns {string}
 */
function parseQuotedString(input) {
  if (input.length < 2 || input[0] !== '"' || input[input.length - 1] !== '"') {
    throw new TypeError('Expected quoted string');
  }

  let result = '';
  for (let i = 1; i < input.length - 1; i++) {
    const char = input[i];
    if (char === '\\') {
      i++;
      if (i >= input.length - 1) {
        throw new TypeError('Unterminated escape in quoted string');
      }
      result += input[i];
    } else {
      result += char;
    }
  }
  return result;
}

/**
 * Quote a string for use as a quoted-string parameter value.
 *
 * @param {string} input
 * @returns {string}
 */
function quoteString(input) {
  return `"${input.replace(/(["\\])/g, '\\$1')}"`;
}

/**
 * Parse a Content-Disposition header value into an object.
 *
 * The returned object always has a `type` property with value `'inline'` or
 * `'attachment'`. The `filename` property is present only when the header
 * contains a usable `filename` parameter, and the `filename*` property is
 * present only when the header contains a usable extended filename parameter.
 * When both are present and `filename*` can be decoded, it takes precedence
 * over `filename` as recommended by RFC 6266.
 *
 * Other parameters are collected into a `parameters` object. Parameter names
 * are case-insensitive and are stored in lower case. Values for unknown
 * parameters are returned as strings, with quoted strings unescaped.
 *
 * This function is intentionally strict: malformed extended values cause a
 * throw rather than silently falling back to the plain `filename`. Callers
 * that want a best-effort result can wrap the call in a try/catch.
 *
 * @param {string} header
 * @returns {object}
 */
export function parseContentDisposition(header) {
  const trimmed = header.trim();
  if (!trimmed) {
    throw new TypeError('Content-Disposition header must not be empty');
  }

  const parts = trimmed.split(';');
  const type = parts.shift().trim().toLowerCase();

  if (type !== 'inline' && type !== 'attachment') {
    throw new TypeError(`Unsupported disposition type: ${type}`);
  }

  const result = { type, parameters: {} };
  let plainFilename;
  let extendedFilename;

  for (const part of parts) {
    const segment = part.trim();
    if (!segment) {
      continue;
    }

    const equalsIndex = segment.indexOf('=');
    if (equalsIndex === -1) {
      throw new TypeError(`Malformed parameter: ${segment}`);
    }

    const rawName = segment.slice(0, equalsIndex).trim().toLowerCase();
    const rawValue = segment.slice(equalsIndex + 1).trim();

    if (!TOKEN_RE.test(rawName)) {
      throw new TypeError(`Invalid parameter name: ${rawName}`);
    }

    let value;
    if (rawValue.startsWith('"')) {
      value = parseQuotedString(rawValue);
    } else {
      if (!TOKEN_RE.test(rawValue)) {
        throw new TypeError(`Invalid parameter value for ${rawName}`);
      }
      value = rawValue;
    }

    if (rawName === 'filename') {
      plainFilename = value;
    } else if (rawName === 'filename*') {
      extendedFilename = parseExtendedValue(value);
    } else {
      result.parameters[rawName] = value;
    }
  }

  // RFC 6266 section 4.3: `filename*` takes precedence over `filename` when
  // it is present and can be decoded.
  if (extendedFilename !== undefined) {
    result['filename*'] = extendedFilename;
  }
  if (plainFilename !== undefined) {
    result.filename = plainFilename;
  }

  return result;
}

/**
 * Parse the value of a `filename*` parameter.
 *
 * The syntax is `charset'language'percent-encoded-value`. We only support
 * UTF-8 (`charset` must be `UTF-8` or `utf-8`), which is the charset required
 * by RFC 5987 for new parameters.
 *
 * @param {string} value
 * @returns {string}
 */
function parseExtendedValue(value) {
  const match = EXTENDED_VALUE_RE.exec(value);
  if (!match) {
    throw new TypeError('Malformed extended parameter value');
  }

  const charset = match[1];
  if (charset.toLowerCase() !== 'utf-8') {
    throw new TypeError(`Unsupported charset in extended parameter: ${charset}`);
  }

  return percentDecode(match[3]);
}

/**
 * Build a Content-Disposition header value from an object.
 *
 * The input object must have a `type` property that is either `'inline'` or
 * `'attachment'`. A `filename` property is always encoded as an extended
 * parameter (`filename*`) with UTF-8 encoding. If the filename is also
 * representable as an RFC 2616 token, a plain `filename` parameter is added
 * for compatibility with older user agents.
 *
 * Additional parameters may be provided in the `parameters` object. Parameter
 * names must be valid RFC 2616 tokens. Values are encoded as quoted strings
 * unless they are valid tokens, in which case they are emitted unquoted.
 *
 * @param {object} input
 * @returns {string}
 */
export function buildContentDisposition(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Input must be an object');
  }

  const type = input.type.toLowerCase();
  if (type !== 'inline' && type !== 'attachment') {
    throw new TypeError(`Unsupported disposition type: ${type}`);
  }

  const segments = [type];

  if (input.filename !== undefined) {
    if (typeof input.filename !== 'string') {
      throw new TypeError('filename must be a string');
    }

    // Always emit the extended parameter so Unicode names survive. Add the
    // plain parameter only when it does not need quoting, because a quoted
    // non-ASCII fallback can mislead legacy clients into using a mojibake
    // name.
    segments.push(`filename*=UTF-8''${percentEncode(input.filename)}`);
    if (TOKEN_RE.test(input.filename)) {
      segments.push(`filename=${input.filename}`);
    }
  }

  if (input.parameters !== undefined) {
    if (typeof input.parameters !== 'object' || input.parameters === null) {
      throw new TypeError('parameters must be an object');
    }

    for (const [name, value] of Object.entries(input.parameters)) {
      if (!TOKEN_RE.test(name)) {
        throw new TypeError(`Invalid parameter name: ${name}`);
      }
      if (typeof value !== 'string') {
        throw new TypeError(`Parameter ${name} must have a string value`);
      }

      if (TOKEN_RE.test(value)) {
        segments.push(`${name}=${value}`);
      } else {
        segments.push(`${name}=${quoteString(value)}`);
      }
    }
  }

  return segments.join('; ');
}
