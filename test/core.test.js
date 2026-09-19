import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseContentDisposition,
  buildContentDisposition,
} from '../src/index.js';

test('parse simple attachment with filename', () => {
  const result = parseContentDisposition('attachment; filename=report.pdf');
  assert.equal(result.type, 'attachment');
  assert.equal(result.filename, 'report.pdf');
  assert.equal(result['filename*'], undefined);
  assert.deepEqual(result.parameters, {});
});

test('parse inline with quoted filename containing spaces', () => {
  const result = parseContentDisposition(
    'inline; filename="quarterly report.pdf"',
  );
  assert.equal(result.type, 'inline');
  assert.equal(result.filename, 'quarterly report.pdf');
});

test('parse extended filename with UTF-8 encoding', () => {
  const result = parseContentDisposition(
    "attachment; filename*=UTF-8''%E2%82%AC%20rates.txt",
  );
  assert.equal(result.type, 'attachment');
  assert.equal(result['filename*'], '€ rates.txt');
  assert.equal(result.filename, undefined);
});

test('parse prefers extended filename over plain filename', () => {
  const result = parseContentDisposition(
    "attachment; filename=fallback.txt; filename*=UTF-8''na%C3%AFve.txt",
  );
  assert.equal(result.type, 'attachment');
  assert.equal(result.filename, 'fallback.txt');
  assert.equal(result['filename*'], 'naïve.txt');
});

test('parse handles escaped quote in quoted filename', () => {
  const result = parseContentDisposition(
    'attachment; filename="say \\"hello\\".txt"',
  );
  assert.equal(result.filename, 'say "hello".txt');
});

test('parse collects unknown parameters', () => {
  const result = parseContentDisposition(
    'attachment; filename=x.txt; size=123; custom="a b"',
  );
  assert.equal(result.type, 'attachment');
  assert.equal(result.filename, 'x.txt');
  assert.deepEqual(result.parameters, { size: '123', custom: 'a b' });
});

test('parse throws on empty header', () => {
  assert.throws(() => parseContentDisposition(''), /must not be empty/);
});

test('parse throws on unsupported disposition type', () => {
  assert.throws(
    () => parseContentDisposition('form-data; name=file'),
    /Unsupported disposition type/,
  );
});

test('parse throws on malformed extended value', () => {
  assert.throws(
    () => parseContentDisposition("attachment; filename*=UTF-8''%ZZ"),
    /Malformed extended parameter value/,
  );
});

test('parse throws on non-UTF-8 extended charset', () => {
  assert.throws(
    () => parseContentDisposition("attachment; filename*=ISO-8859-1''foo"),
    /Unsupported charset/,
  );
});

test('build simple attachment', () => {
  const header = buildContentDisposition({
    type: 'attachment',
    filename: 'report.pdf',
  });
  assert.equal(header, "attachment; filename*=UTF-8''report.pdf; filename=report.pdf");
});

test('build unicode filename uses extended parameter only', () => {
  const header = buildContentDisposition({
    type: 'attachment',
    filename: 'résumé.pdf',
  });
  assert.equal(
    header,
    "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf",
  );
});

test('build filename with space uses extended parameter only', () => {
  const header = buildContentDisposition({
    type: 'inline',
    filename: 'my file.txt',
  });
  assert.equal(header, "inline; filename*=UTF-8''my%20file.txt");
});

test('build includes additional parameters', () => {
  const header = buildContentDisposition({
    type: 'attachment',
    filename: 'x.txt',
    parameters: {
      size: '42',
      note: 'hello world',
    },
  });
  assert.equal(
    header,
    "attachment; filename*=UTF-8''x.txt; filename=x.txt; size=42; note=\"hello world\"",
  );
});

test('round trip preserves unicode filename', () => {
  const original = 'naïve – file.txt';
  const header = buildContentDisposition({ type: 'attachment', filename: original });
  const parsed = parseContentDisposition(header);
  assert.equal(parsed['filename*'], original);
});

test('build rejects invalid parameter name', () => {
  assert.throws(
    () =>
      buildContentDisposition({
        type: 'attachment',
        parameters: { 'bad name': 'value' },
      }),
    /Invalid parameter name/,
  );
});
