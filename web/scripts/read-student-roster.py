"""Read roster OOXML without changing the workbook or requiring dependencies.

Only admission number, name, class, and source coordinates enter the manifest.
Parent contacts, dates of birth, and other unrelated fields remain in the source.
"""
import argparse
import hashlib
import json
import posixpath
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from zipfile import ZipFile

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
RID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'

def clean(value):
    return ' '.join(str(value).split()) if value is not None else ''

def read_roster(source, excluded):
    students, excluded_counts, classes, seen = [], {}, {}, {}
    source_count = 0
    with ZipFile(source) as archive:
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        targets = {r.attrib['Id']: r.attrib['Target'] for r in relationships}
        shared = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared = [''.join(t.text or '' for t in item.iterfind('.//s:t', NS))
                      for item in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        sheets = workbook.findall('s:sheets/s:sheet', NS)
        unknown = excluded - {s.attrib['name'] for s in sheets}
        if unknown:
            raise ValueError(f'Unknown excluded sheets: {sorted(unknown)}')
        for sheet in sheets:
            name = sheet.attrib['name']
            target = targets[sheet.attrib[RID]]
            target = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
            root = ET.fromstring(archive.read(target))
            rows = []
            for row in root.findall('s:sheetData/s:row', NS):
                cells = {}
                for cell in row.findall('s:c', NS):
                    address = cell.attrib['r']
                    column = ''.join(c for c in address if c.isalpha())
                    value = cell.find('s:v', NS)
                    raw = value.text if value is not None else None
                    kind = cell.attrib.get('t', 'n')
                    if kind == 's':
                        raw = shared[int(raw)] if raw is not None else None
                    elif kind == 'inlineStr':
                        raw = ''.join(t.text or '' for t in cell.iterfind('.//s:t', NS))
                    if column in ('A', 'B', 'C') and cell.find('s:f', NS) is not None:
                        raise ValueError(f'{name}!{address}: formula in identity/serial field')
                    if raw is not None and raw != '':
                        cells[column] = (raw, kind)
                rows.append((int(row.attrib['r']), cells))
            by_row = dict(rows)
            headers = [clean(by_row.get(2, {}).get(c, ('',))[0]).upper() for c in ('A', 'B', 'C')]
            if headers != ['S.NO.', 'NAME', 'ADM.NO.']:
                raise ValueError(f'{name}: unexpected headers {headers}')
            headings = [clean(v[0]).upper() for v in by_row.get(1, {}).values()]
            if name not in excluded and headings != [clean(name).upper()]:
                raise ValueError(f'{name}: class heading disagrees with tab: {headings}')
            count = 0
            for number, cells in rows:
                if number <= 2 or not cells:
                    continue
                serial, raw_name, admission = [cells.get(c, ('', ''))[0] for c in ('A', 'B', 'C')]
                if not all(clean(v) for v in (serial, raw_name, admission)):
                    raise ValueError(f'{name}!A{number}: incomplete or unclassified nonempty row')
                if str(serial) != str(count + 1):
                    raise ValueError(f'{name}!A{number}: serial sequence mismatch')
                if cells['C'][1] not in ('s', 'inlineStr', 'str'):
                    raise ValueError(f'{name}!C{number}: admission number must be stored as text')
                admission = admission.strip()
                if len(admission) > 100 or len(clean(raw_name)) > 100:
                    raise ValueError(f'{name}!{number}: identity exceeds database input limits')
                if admission in seen:
                    raise ValueError(f'{name}!C{number}: duplicate admission number also in {seen[admission]}')
                seen[admission] = f'{name}!C{number}'
                count += 1
                if name not in excluded:
                    students.append({'admissionNumber': admission, 'name': clean(raw_name),
                                     'className': name, 'sourceSheet': name,
                                     'sourceRow': number, 'sourceSerial': int(serial),
                                     'sourceName': raw_name})
            source_count += count
            if name in excluded:
                excluded_counts[name] = count
            else:
                classes[name] = count
        if not students:
            raise ValueError('No students found')
    return {'version': 1, 'sourceFile': str(source.resolve()),
            'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'sourceStudentCount': source_count, 'excludedSheets': excluded_counts,
            'classes': classes, 'students': students}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--exclude-sheet', action='append', default=[])
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = read_roster(args.source, set(args.exclude_sheet))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k not in ('sourceFile', 'students')}))
    print(f"Validated {len(result['students'])} students; manifest saved to {args.output}")
