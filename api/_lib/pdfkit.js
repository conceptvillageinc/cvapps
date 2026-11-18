import PDFDocument from 'pdfkit';

// ============================================================================
// pdfkit を、文字を「合成済みの形（NFC）」にそろえてから描くようにして渡す。
//   Mac のファイル名や PDF からコピーした文字は「ぶ」が「ふ」＋「゛」の 2 文字（濁点が別の文字）に
//   なっていることがあり、そのまま描くと濁点・半濁点が文字からずれて見える。
//   描く・幅を測る前に NFC にすると「ぶ」1 文字になり、ずれない。
//   PDF を作るファイルは、pdfkit ではなくこのファイルから PDFDocument を読み込む。
// ============================================================================

const nfc = (v) => (typeof v === 'string' ? v.normalize('NFC') : v);
const proto = PDFDocument.prototype;
if (!proto.__nfcPatched) {
  for (const name of ['text', 'widthOfString', 'heightOfString']) {
    const original = proto[name];
    proto[name] = function patched(str, ...rest) { return original.call(this, nfc(str), ...rest); };
  }
  proto.__nfcPatched = true;
}

export default PDFDocument;
