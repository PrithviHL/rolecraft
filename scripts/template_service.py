"""Prepare a local Word resume while retaining its original Word styling."""
import io
import json
import re
from base64 import b64encode
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from zipfile import BadZipFile, ZipFile
from xml.dom import minidom
from xml.parsers.expat import ExpatError

WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
DOCUMENT = 'word/document.xml'
HEADINGS = {'EDUCATION', 'SKILLS', 'TECHNICAL SKILLS', 'PROFESSIONAL EXPERIENCE',
            'WORK EXPERIENCE', 'EXPERIENCE', 'PROJECTS', 'CERTIFICATIONS',
            'SUMMARY', 'PROFESSIONAL SUMMARY', 'PUBLICATIONS', 'AWARDS'}
MAX_UPLOAD = 5 * 1024 * 1024
MAX_EXPANDED = 30 * 1024 * 1024


def paragraphs(body):
    return [node for node in body.childNodes
            if node.nodeType == node.ELEMENT_NODE and node.namespaceURI == WORD
            and node.localName == 'p']


def paragraph_text(paragraph):
    parts = []
    for node in paragraph.getElementsByTagNameNS(WORD, '*'):
        if node.localName == 't':
            parts.append(''.join(child.data for child in node.childNodes
                                 if child.nodeType == child.TEXT_NODE))
        elif node.localName == 'tab':
            parts.append('\t')
        elif node.localName in ('br', 'cr'):
            parts.append('\n')
    text = ''.join(parts)
    if text.strip() and paragraph.getElementsByTagNameNS(WORD, 'numPr'):
        return '- ' + text
    return text


def section_rows(body, headings):
    rows = paragraphs(body)
    labels = [paragraph_text(row).strip().upper() for row in rows]
    start = next((i + 1 for i, label in enumerate(labels) if label in headings), None)
    if start is None:
        return []
    end = next((i for i in range(start, len(rows)) if labels[i] in HEADINGS), len(rows))
    return rows[start:end]


def tailor_skills(body, job):
    """Retain exact source skill names and their original text runs."""
    jd = job.casefold()
    aliases = {
        'rest': ('rest', 'rest api', 'restful api'),
        'ci/cd': ('ci/cd', 'continuous integration', 'continuous delivery'),
        'aws': ('aws', 'amazon web services'),
        'javascript': ('javascript', 'js'),
        'typescript': ('typescript',),
    }
    candidates = []
    for row in section_rows(body, {'SKILLS', 'TECHNICAL SKILLS'}):
        nodes = [child for el in row.getElementsByTagNameNS(WORD, 't')
                 for child in el.childNodes if child.nodeType == child.TEXT_NODE]
        text = ''.join(node.data for node in nodes)
        colon = text.find(':')
        if colon < 1 or any(row.getElementsByTagNameNS(WORD, tag) for tag in ('tab', 'br', 'hyperlink')):
            continue
        rest = text[colon + 1:]
        spans = []
        depth = start = 0
        for i, char in enumerate(rest + ','):
            if char == '(':
                depth += 1
            elif char == ')':
                depth = max(0, depth - 1)
            elif char == ',' and not depth:
                spans.append((start, i))
                start = i + 1
        if len(spans) < 2:
            continue

        def matches(span):
            value = rest[slice(*span)].strip().casefold()
            name = value.split(' (', 1)[0]
            terms = (*aliases.get(name, (name,)), value)
            return any(term and re.search(r'(?<![\w+#])' + re.escape(term) + r'(?![\w+#])', jd)
                       for term in terms)

        keep = [i for i, span in enumerate(spans) if matches(span)]
        candidates.append((row, nodes, rest, colon + 1, spans, keep))
    # Avoid stripping a skills section when a posting barely names technologies.
    if sum(len(keep) for _, _, _, _, _, keep in candidates) < 3:
        return
    for row, nodes, rest, offset, spans, keep in candidates:
        if not keep or len(keep) == len(spans):
            continue
        excluded = set()
        for i, (start, end) in enumerate(spans):
            if i not in keep:
                excluded.update(range(offset + start, offset + min(end + 1, len(rest))))
        # If the tail was removed, the final retained skill no longer needs its comma.
        last_end = spans[keep[-1]][1]
        if last_end < len(rest):
            excluded.add(offset + last_end)
        index = 0
        for node in nodes:
            original = node.data
            node.data = ''.join(char for relative, char in enumerate(original)
                                if index + relative not in excluded)
            if node.data.strip() != node.data:
                node.parentNode.setAttribute('xml:space', 'preserve')
            index += len(original)


def rank_experience_bullets(body, job):
    """Move intact list paragraphs within each role so relevant evidence comes first."""
    terms = set(re.findall(r'[a-z][a-z0-9+#.]{2,}', job.lower()))
    rows = section_rows(body, {'PROFESSIONAL EXPERIENCE', 'WORK EXPERIENCE', 'EXPERIENCE'})
    group = []
    for row in [*rows, None]:
        if row is not None and paragraph_text(row).startswith('- '):
            if not group or group[-1].nextSibling is row:
                group.append(row)
                continue
        if len(group) > 1:
            anchor = group[-1].nextSibling
            ranked = sorted(group, key=lambda item: len(terms & set(
                re.findall(r'[a-z][a-z0-9+#.]{2,}', paragraph_text(item).lower()))), reverse=True)
            for item in ranked:
                body.removeChild(item)
                body.insertBefore(item, anchor) if anchor is not None else body.appendChild(item)
        group = [row] if row is not None and paragraph_text(row).startswith('- ') else []


def rank_projects(body, job):
    rows = paragraphs(body)
    labels = [paragraph_text(row).strip() for row in rows]
    if 'PROJECTS' not in labels:
        return
    start = labels.index('PROJECTS') + 1
    end = next((i for i in range(start, len(rows)) if labels[i] in HEADINGS), len(rows))
    region = rows[start:end]
    blocks = []
    for index, row in enumerate(region):
        label = labels[start + index]
        if '|' in label and not label.startswith('- '):
            blocks.append([])
        if blocks:
            blocks[-1].append(row)
        elif label:
            return
    if len(blocks) < 2 or any(not any(paragraph_text(row).startswith('- ') for row in block)
                              for block in blocks):
        return
    first, last = blocks[0][0], blocks[-1][-1]
    # Leave tables, drawings outside paragraphs, and any other interleaved nodes untouched.
    cursor = first
    while cursor is not last:
        cursor = cursor.nextSibling
        if cursor is None or (cursor.nodeType == cursor.ELEMENT_NODE and cursor not in region):
            return
    anchor = last.nextSibling
    tokenizer = re.compile(r'[a-z][a-z0-9+#.]{2,}')
    terms = set(tokenizer.findall(job.lower()))

    def relevance(block):
        title = set(tokenizer.findall(paragraph_text(block[0]).lower()))
        content = set(tokenizer.findall(' '.join(map(paragraph_text, block[1:])).lower()))
        return 2 * len(title & terms) + len(content & terms)

    for block in sorted(blocks, key=relevance, reverse=True):
        for row in block:
            existing = body.removeChild(row)
            body.insertBefore(existing, anchor) if anchor is not None else body.appendChild(existing)


def remove_junior_summary(body, job):
    title = next(iter(job.strip().splitlines()), '')
    if not re.search(r'\b(?:junior|jr\.?|entry.level)\b', title, re.I):
        return
    rows = paragraphs(body)
    for i, row in enumerate(rows):
        if paragraph_text(row).strip().upper() in {'SUMMARY', 'PROFESSIONAL SUMMARY'}:
            end = next((j for j in range(i + 1, len(rows))
                        if paragraph_text(rows[j]).strip().upper() in HEADINGS), len(rows))
            for item in rows[i:end]:
                body.removeChild(item)
            return


def prepare(data, job):
    with ZipFile(io.BytesIO(data)) as original:
        if sum(entry.file_size for entry in original.infolist()) > MAX_EXPANDED:
            raise ValueError('Word document expands beyond the local size limit.')
        document_xml = original.read(DOCUMENT)
        if b'<!DOCTYPE' in document_xml.upper():
            raise ValueError('XML document type declarations are unsupported.')
        document = minidom.parseString(document_xml)
        body = document.getElementsByTagNameNS(WORD, 'body')[0]
        text = '\n'.join(map(paragraph_text, paragraphs(body))).strip()
        if len(text) < 30:
            raise ValueError('The Word document has too little readable body text.')
        remove_junior_summary(body, job)
        tailor_skills(body, job)
        rank_experience_bullets(body, job)
        rank_projects(body, job)
        output = io.BytesIO()
        with ZipFile(output, 'w') as archive:
            for entry in original.infolist():
                content = document.toxml(encoding='UTF-8') if entry.filename == DOCUMENT else original.read(entry)
                archive.writestr(entry, content)
    return {'text': text, 'templateDocx': b64encode(output.getvalue()).decode('ascii')}


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != '/prepare':
            self.send_json(404, {'error': 'Unknown endpoint'})
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= MAX_UPLOAD:
                raise ValueError('Upload a DOCX smaller than 5 MB.')
            header = self.headers.get('Content-Type', '')
            message = BytesParser(policy=policy.default).parsebytes(
                ('Content-Type: ' + header + '\r\nMIME-Version: 1.0\r\n\r\n').encode() + self.rfile.read(size))
            fields = {part.get_param('name', header='content-disposition'): part.get_payload(decode=True)
                      for part in message.iter_parts()}
            self.send_json(200, prepare(fields['resume'], fields.get('job', b'').decode('utf-8')))
        except (BadZipFile, ExpatError, KeyError, IndexError, ValueError) as error:
            self.send_json(400, {'error': 'Unable to read this DOCX template.', 'detail': str(error)})


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
