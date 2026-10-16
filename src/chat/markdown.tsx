import type { ReactNode } from 'react';

/**
 * The little markup the assistant uses: paragraphs, "- " lists, **bold**, and links to elements written [label](#w:alias). Nothing else is
 * drawn as markup, and nothing is ever inserted as HTML.
 */
function inline(text: string, onElement: (alias: string) => void, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(#w:([A-Za-z0-9_]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2]) out.push(<button key={`${key}-${i}`} type="button" className="chat__link" onClick={() => onElement(m![2])}>{m[1]}</button>);
    else out.push(<strong key={`${key}-${i}`}>{m[3]}</strong>);
    last = m.index + m[0].length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, onElement }: { text: string; onElement: (alias: string) => void }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: number) => {
    if (list.length === 0) return;
    blocks.push(<ul key={`ul${k}`} className="chat__list">{list.map((li, j) => <li key={j}>{inline(li, onElement, `l${k}-${j}`)}</li>)}</ul>);
    list = [];
  };
  text.split('\n').forEach((line, k) => {
    const item = /^\s*[-•]\s+(.*)$/.exec(line);
    if (item) list.push(item[1]);
    else {
      flush(k);
      if (line.trim() !== '') blocks.push(<p key={`p${k}`}>{inline(line, onElement, `p${k}`)}</p>);
    }
  });
  flush(text.length);
  return <>{blocks}</>;
}
