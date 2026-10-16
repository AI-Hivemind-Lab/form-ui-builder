const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const CalendarIcon = () => (
  <svg {...base} aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M7 13h4" /></svg>
);
export const PlusIcon = () => (
  <svg {...base} aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" /><path d="M12 8v8M8 12h8" stroke="#fff" /></svg>
);
export const SearchIcon = () => (
  <svg {...base} aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
);

export const UndoIcon = () => (
  <svg {...base} aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
);
export const TrashIcon = () => (
  <svg {...base} width={16} height={16} aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
);
export const CopyIcon = () => (
  <svg {...base} width={16} height={16} aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>
);
export const CaretIcon = ({ open }: { open: boolean }) => (
  <svg {...base} width={14} height={14} aria-hidden="true"><path d={open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'} fill="currentColor" /></svg>
);

const BOX = 'M4 7h16v10H4z';
const FILE = 'M6 3h8l4 4v14H6z M14 3v4h4';
/** Simple stroke glyphs per widget id; `text` ones draw a character instead of a path. */
const GLYPHS: Record<string, { d?: string; text?: string }> = {
  Group: { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
  Page: { d: `${FILE} M9 13h6 M9 17h6` },
  Paragraph: { text: 'Aa' },
  Header: { text: 'H' },
  TextBox: { d: `${BOX} M12 10v4` },
  MultipleCheckbox: { d: 'M4 4h16v16H4z M8 12l3 3 5-6' },
  MultipleSuggest: { d: 'M4 7l2 2 3-3 M12 7h8 M4 15l2 2 3-3 M12 15h8' },
  Radio: { d: 'M12 4a8 8 0 1 0 0.01 0z M12 9a3 3 0 1 0 0.01 0z' },
  Dropdown: { d: 'M8 10l4-4 4 4 M8 14l4 4 4-4' },
  Signature: { d: 'M4 20l4-1 11-11-3-3L5 16z M14 7l3 3' },
  Pdf: { d: `${FILE} M12 14a2 2 0 1 0 0.01 0z` },
  Repeatable: { d: 'M8 8h12v12H8z M4 4h12 M4 4v12' },
  TextArea: { d: 'M4 5h16v14H4z M8 9h8 M8 13h5' },
  Integer: { text: '123' },
  Float: { text: '1.5' },
  Percentage: { text: '%' },
  Money: { text: '$' },
  Year: { d: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4 M8 14h2' },
  Email: { d: 'M3 6h18v12H3z M3 6l9 7 9-7' },
  Date: { d: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4' },
  Phone: { d: 'M8 3h8v18H8z M11 18h2' },
  FileGroup: { d: 'M8 8h12v12H8z M4 4h12v2 M4 4v12h2' },
  File: { d: FILE },
  AnchorLink: { d: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1 M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1' },
  Country: { d: 'M5 21V4 M5 4h12l-2 4 2 4H5' },
  State: { d: 'M5 21V4 M5 4h12v8H5' },
  CustomFormat: { d: `${BOX} M8 12h8` },
};

export function WidgetIcon({ id }: { id: string }) {
  const g = GLYPHS[id] ?? { d: BOX };
  return (
    <svg {...base} width={22} height={22} aria-hidden="true">
      {g.text ? (
        <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="600" fill="currentColor" stroke="none">{g.text}</text>
      ) : (
        <path d={g.d} />
      )}
    </svg>
  );
}
