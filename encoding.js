// SubStream — subtitle file encoding detection
(function (global) {
  'use strict';

  const ENCODINGS = ['utf-8', 'windows-1256', 'iso-8859-6', 'windows-1252', 'iso-8859-1'];

  function scoreDecodedText(text) {
    if (!text || !text.trim()) return -Infinity;

    let score = 0;
    let replacement = 0;
    let letters = 0;

    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp === 0xFFFD) { replacement++; continue; }
      if (cp < 32 && ch !== '\n' && ch !== '\r' && ch !== '\t') { score -= 5; continue; }

      if (
        (cp >= 0x0600 && cp <= 0x06FF) ||
        (cp >= 0x0750 && cp <= 0x077F) ||
        (cp >= 0xFB50 && cp <= 0xFDFF) ||
        (cp >= 0xFE70 && cp <= 0xFEFF) ||
        (cp >= 0x0041 && cp <= 0x024F) ||
        (cp >= 0x0400 && cp <= 0x04FF) ||
        (cp >= 0x4E00 && cp <= 0x9FFF) ||
        (cp >= 0x0590 && cp <= 0x05FF)
      ) {
        letters++;
      }
    }

    score += letters * 2;
    score -= replacement * 50;

    // Common mojibake when UTF-8 bytes are misread
    if (/Ã.|ï¿½|Ø§Ù|ÙØ|â€/.test(text)) score -= 40;

    return score;
  }

  function decodeWithEncoding(bytes, encoding) {
    return new TextDecoder(encoding, { fatal: false }).decode(bytes);
  }

  function decodeSubtitleBytes(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!bytes.length) return '';

    // UTF-8 BOM
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return decodeWithEncoding(bytes.slice(3), 'utf-8');
    }

    // UTF-16 LE BOM
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return decodeWithEncoding(bytes.slice(2), 'utf-16le');
    }

    let bestText = '';
    let bestScore = -Infinity;

    for (const encoding of ENCODINGS) {
      try {
        const text = decodeWithEncoding(bytes, encoding);
        const s = scoreDecodedText(text);
        if (s > bestScore) {
          bestScore = s;
          bestText = text;
        }
      } catch (_) {}
    }

    return bestText || decodeWithEncoding(bytes, 'utf-8');
  }

  function readSubtitleFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(decodeSubtitleBytes(new Uint8Array(reader.result)));
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  global.SubStreamEncoding = { decodeSubtitleBytes, readSubtitleFile };
})(typeof self !== 'undefined' ? self : this);
