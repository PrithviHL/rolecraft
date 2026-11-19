const names = [...new Set($('Application Form').first().json.team.split(/[\n,]+/).map(name => name.trim()).filter(Boolean))];

function parseReply(nodeName) {
  const reply = $(nodeName).first().json;
  if (reply.done !== true || reply.done_reason === 'length') {
    throw new Error(nodeName + ' did not finish. Try shorter inputs or a higher output limit.');
  }
  try {
    return JSON.parse(reply.message.content);
  } catch {
    throw new Error(nodeName + ' returned invalid JSON. Run the form again or try a larger local model.');
  }
}

function singleLine(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error('Invalid or missing ' + label + ' in the model response.');
  }
  return value.replace(/\s+/g, ' ').trim();
}

const draft = parseReply('Tailor Resume');
function plainText(value) {
  return value.replace(/^\s*[•●★]\s*/u, '- ').replace(/[*★●•]/gu, '').replace(/→/gu, '-').trim();
}

function filenameSegment(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 70).replace(/_+$/, '');
  return cleaned || fallback;
}

function sourceLine(value) {
  if (typeof value !== 'string' || value.length > 750 || /[\r\n]/.test(value)) {
    throw new Error('Invalid resume line. The model must return one string per line.');
  }
  const leading = value.match(/^[ \t]*/)[0].replace(/\t/g, '  ');
  const content = plainText(value);
  return content ? leading + content : '';
}

const jobTitle = filenameSegment(draft.job_title, 'Job_Title');
const companyName = filenameSegment(draft.company_name, 'Company_Name');
const resumeFilename = 'Prithvi_HL_' + jobTitle + '_' + companyName + '.docx';
const resume = {
  name: singleLine(draft.name, 'candidate name', 120),
  contact: typeof draft.contact === 'string' ? draft.contact.replace(/\s+/g, ' ').trim() : '',
  sections: [],
};
if (!Array.isArray(draft.sections) || !draft.sections.length || draft.sections.length > 10) {
  throw new Error('The resume model returned an invalid section list.');
}
for (const section of draft.sections) {
  if (!Array.isArray(section.lines) || !section.lines.length || section.lines.length > 60) {
    throw new Error('The resume model returned an invalid section body.');
  }
  resume.sections.push({
    heading: plainText(singleLine(section.heading, 'section heading', 80)).toUpperCase(),
    lines: section.lines.map(sourceLine),
  });
}

const certificates = resume.sections.findIndex(section => section.heading === 'CERTIFICATIONS');
if (certificates >= 0) {
  const [section] = resume.sections.splice(certificates, 1);
  let count = 0;
  section.lines = section.lines.filter(line => !line || ++count <= 4);
  while (section.lines.length && !section.lines.at(-1)) section.lines.pop();
  resume.sections.push(section);
}

const { messages } = parseReply('Draft Outreach');
if (!Array.isArray(messages) || messages.length !== names.length) {
  throw new Error('The outreach model must return one draft per named person.');
}
const draftsByRecipient = new Map();
for (const { recipient_id: id, message } of messages) {
  if (!Number.isInteger(id) || id < 1 || id > names.length || draftsByRecipient.has(id)) {
    throw new Error('The outreach model returned missing or duplicate recipient IDs.');
  }
  draftsByRecipient.set(id, singleLine(message, 'outreach draft', 600));
}
const outreach = names.map((name, i) => ({
  name,
  message: 'Hi ' + name + ', ' + draftsByRecipient.get(i + 1),
}));

function escapeXml(value) {
  return value.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function paragraph(value, { bold = false, before = 0, after = 35, keep = false } = {}) {
  const indent = Math.min(value.match(/^ */)[0].length, 16) * 80;
  const properties = (keep ? '<w:keepNext/>' : '') +
    '<w:spacing w:before="' + before + '" w:after="' + after + '"/>' +
    (indent ? '<w:ind w:left="' + indent + '"/>' : '') + '<w:jc w:val="both"/>';
  const run = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>' + (bold ? '<w:b/>' : '') +
    '<w:color w:val="000000"/><w:sz w:val="20"/><w:szCs w:val="20"/>';
  return '<w:p><w:pPr>' + properties + '</w:pPr><w:r><w:rPr>' + run +
    '</w:rPr><w:t xml:space="preserve">' + escapeXml(value.trimStart() || ' ') + '</w:t></w:r></w:p>';
}

// Write small, uncompressed ZIP archives using the standard ZIP headers.
// This keeps the n8n Code node runnable without third-party packages.
function zip(files) {
  const localParts = [];
  const directory = [];
  let offset = 0;
  for (const [filename, content] of Object.entries(files)) {
    const name = Buffer.from(filename);
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(33, 12); // DOS date 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    local.copy(central, 6, 4, 30);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, name, data);
    directory.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const index = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(directory.length / 2, 8);
  end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, index, end]);
}

const paragraphs = [paragraph(resume.name, { bold: true, keep: true })];
if (resume.contact) paragraphs.push(paragraph(resume.contact, { after: 120, keep: true }));
for (const section of resume.sections) {
  paragraphs.push(paragraph(section.heading, { bold: true, before: 115, keep: true }));
  paragraphs.push(...section.lines.map(line => paragraph(line)));
}
const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const docx = zip({
  '[Content_Types].xml': xml + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels': xml + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml': xml + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paragraphs.join('') + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="864" w:right="864" w:bottom="864" w:left="864" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>',
});
const outreachText = 'Outreach drafts for review\n\n' +
  outreach.map(({ name, message }) => name + '\n' + message).join('\n\n') + '\n';
const reviewNotes = Array.isArray(draft.review_notes) ? draft.review_notes.filter(note => typeof note === 'string') : [];
const jobDescription = String($('Application Form').first().json.job ?? '');
if (/\b(?:U\.?S\.?|United States)\s+citizen(?:ship|s)?\b|\bcitizen(?:ship)?\s+of\s+the\s+United States\b/i.test(jobDescription)) {
  reviewNotes.unshift('The job description mentions US citizenship. Review the exact posting language to confirm whether it is required.');
}
if (jobTitle === 'Job_Title' || companyName === 'Company_Name') {
  reviewNotes.push('The model could not identify the job title or company. Replace the filename placeholder before submitting.');
}
const keywordLabels = {
  hard_skills_tools: 'Hard skills and tools',
  soft_skills: 'Soft skills',
  certifications_degrees: 'Certifications and degrees',
  key_phrases: 'Key phrases',
};
const keywordLines = Object.entries(keywordLabels).map(([key, label]) => {
  const terms = draft.ats_keywords?.[key];
  return label + ': ' + (Array.isArray(terms) ? terms.filter(term => typeof term === 'string').join(', ') : '');
});
const reviewText = 'RESUME REVIEW\n\n' + keywordLines.join('\n') +
  '\n\nCHECK BEFORE SUBMITTING\n- Open the DOCX in Word and confirm it fits within two pages.\n' +
  reviewNotes.map(note => '- ' + note).join('\n') + '\n';
const bundle = zip({
  [resumeFilename]: docx,
  'outreach-drafts.txt': outreachText,
  'resume-review.txt': reviewText,
});
return [{
  json: { resume, resumeFilename, outreach, reviewNotes },
  binary: {
    bundle: { data: bundle.toString('base64'), fileName: 'application-drafts.zip', mimeType: 'application/zip', fileExtension: 'zip' },
  },
}];
