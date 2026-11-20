// Decode only a completed prefix of a JSON string. Raw JSON is never sent to the UI.
export function partialString(json, field) {
  const match = new RegExp(`(?:^|[,{])\\s*"${field}"\\s*:\\s*"`).exec(json);
  if (!match) return null;
  let value = '';
  const start = match.index + match[0].length;
  for (let i = start; i < json.length; i++) {
    const c = json[i];
    if (c === '"') break;
    if (c !== '\\') { value += c; continue; }
    const escaped = json[++i];
    if (escaped === undefined) break;
    if (escaped === 'u') {
      const hex = json.slice(i + 1, i + 5);
      if (!/^[0-9a-f]{4}$/i.test(hex)) break;
      value += String.fromCharCode(parseInt(hex, 16)); i += 4;
    } else {
      const known = { '"': '"', '\\': '\\', '/': '/', n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
      if (!(escaped in known)) break;
      value += known[escaped];
    }
  }
  return value.replace(/[\uD800-\uDBFF]$/, '');
}
